/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ChatMessage, CopilotSettings, ToolCall, McpTool, ChatSessionSummary } from "./types.js";
import { LlmClient } from "./llm-client.js";
import { McpClientManager } from "./mcp-client.js";
import { McpServerLocal } from "./mcp/mcp-server-local.js";
import { LocalTransport } from "./mcp/local-transport.js";
import { HistoryStore } from "./history-store.js";
import { ensureCockpitReady } from "./cockpit-ready.js";

type UpdateCallback = (messages: ChatMessage[]) => void;

const MAX_CONTEXT_MESSAGES = 80;
const MAX_TOOL_ITERATIONS = 8;
const STREAM_UPDATE_INTERVAL_MS = 33;

const formatToolName = (name: string): string =>
    name
            .replace(/__/g, ": ")
            .replace(/_/g, " ")
            .replace(/\b\w/g, letter => letter.toUpperCase());

const safeJsonParse = (value: string): Record<string, unknown> => {
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
};

const isAbortError = (error: unknown): boolean =>
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");

export class Agent {
    private settings: CopilotSettings;
    private llm: LlmClient;
    private mcpManager: McpClientManager;
    private historyStore: HistoryStore;
    private messages: ChatMessage[] = [];
    private loadedMessageCount = 0;
    private onUpdate: UpdateCallback;
    private systemContext = "";
    private loopPromise: Promise<void> | null = null;
    private requestAbortController: AbortController | null = null;
    private history: Record<string, ChatSessionSummary> = {};
    private toolMetadata = new Map<string, McpTool>();

    public isProcessing = false;
    public currentChatId: string | null = null;
    public pendingApprovals: {
        toolCall: ToolCall;
        resolve: (value: boolean) => void;
    }[] = [];

    constructor(settings: CopilotSettings, mcpManager: McpClientManager, onUpdate: UpdateCallback) {
        this.settings = settings;
        this.mcpManager = mcpManager;
        this.historyStore = new HistoryStore();
        this.onUpdate = onUpdate;
        this.llm = this.createLlm(settings);
    }

    private createLlm(settings: CopilotSettings): LlmClient {
        return new LlmClient({
            apiKey: settings.llm.apiKey,
            baseUrl: settings.llm.baseUrl,
            model: settings.llm.model,
            useHostProxy: settings.llm.provider === "custom"
        });
    }

    async init(): Promise<void> {
        await ensureCockpitReady();
        this.history = await this.historyStore.initialize();

        if (Object.keys(this.history).length === 0) {
            await this.createChat();
        } else {
            const recent = this.getHistory()[0];
            if (recent)
                await this.switchToChat(recent.id);
        }

        await this.setupConnection();

        // Legacy history can be large. It is deliberately migrated after the
        // local agent is usable, rather than blocking first paint and MCP setup.
        setTimeout(() => {
            this.migrateLegacyHistory().catch(error => console.error("Legacy history migration failed:", error));
        }, 0);
    }

    public getHistory(): ChatSessionSummary[] {
        return Object.values(this.history).sort((a, b) => b.lastModified - a.lastModified);
    }

    private async migrateLegacyHistory(): Promise<void> {
        const sessions = await this.historyStore.migrateLegacy();
        if (sessions.length === 0)
            return;

        for (const session of sessions) {
            this.history[session.id] = {
                id: session.id,
                title: session.title,
                lastModified: session.lastModified,
                messageCount: session.messages.length
            };
        }

        const recent = this.getHistory()[0];
        const current = this.currentChatId ? this.history[this.currentChatId] : undefined;
        if (recent && current && current.title === "New Chat" && this.messages.length === 0) {
            await this.switchToChat(recent.id);
        } else {
            this.onUpdate(this.messages);
        }
    }

    private async createChat(): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const session = {
            id,
            title: "New Chat",
            messages: [],
            lastModified: now,
            loadedMessageCount: 0
        };

        await this.historyStore.saveChat(session);
        await this.historyStore.flush();
        this.history[id] = { id, title: session.title, lastModified: now, messageCount: 0 };
        this.currentChatId = id;
        this.messages = [];
        this.loadedMessageCount = 0;
        this.onUpdate(this.messages);
        return id;
    }

    public async createNewChat(): Promise<string> {
        if (this.loopPromise)
            throw new Error("Cannot create a chat while a response is processing");
        return this.createChat();
    }

    public async switchToChat(id: string): Promise<void> {
        if (this.loopPromise)
            throw new Error("Cannot switch chats while a response is processing");
        if (!this.history[id])
            return;

        const session = await this.historyStore.loadChat(id);
        this.currentChatId = id;
        this.messages = session?.messages || [];
        this.loadedMessageCount = session?.loadedMessageCount ?? this.messages.length;
        this.onUpdate(this.messages);
    }

    public async deleteChat(id: string): Promise<void> {
        if (this.loopPromise)
            throw new Error("Cannot delete a chat while a response is processing");

        await this.historyStore.deleteChat(id);
        delete this.history[id];

        if (this.currentChatId === id) {
            this.currentChatId = null;
            this.messages = [];
            this.loadedMessageCount = 0;
            const remaining = this.getHistory()[0];
            if (remaining)
                await this.switchToChat(remaining.id);
            else
                await this.createChat();
        }
        await this.historyStore.flush();
        this.onUpdate(this.messages);
    }

    private async saveCurrentChat(): Promise<void> {
        if (!this.currentChatId || !this.history[this.currentChatId])
            return;

        const current = this.history[this.currentChatId];
        let title = current.title;
        if (title === "New Chat") {
            const firstUserMessage = this.messages.find(message => message.role === "user");
            if (firstUserMessage)
                title = firstUserMessage.content.slice(0, 30) + (firstUserMessage.content.length > 30 ? "..." : "");
        }

        const appendedMessages = this.messages.length >= this.loadedMessageCount;
        const messageCount = appendedMessages
            ? (current.messageCount ?? this.loadedMessageCount) + this.messages.length - this.loadedMessageCount
            : this.messages.length;
        const session = {
            id: this.currentChatId,
            title,
            messages: this.messages,
            lastModified: Date.now(),
            messageCount,
            loadedMessageCount: this.loadedMessageCount
        };
        await this.historyStore.saveChat(session);
        this.loadedMessageCount = this.messages.length;
        this.history[this.currentChatId] = {
            id: session.id,
            title: session.title,
            lastModified: session.lastModified,
            messageCount
        };
    }

    public async reconfigure(newSettings: CopilotSettings): Promise<void> {
        this.cancel();
        if (this.loopPromise)
            await this.loopPromise;

        this.settings = newSettings;
        this.llm = this.createLlm(newSettings);
        await this.mcpManager.close();
        await this.setupConnection();
    }

    public cancel(): void {
        this.requestAbortController?.abort();
        for (const approval of this.pendingApprovals)
            approval.resolve(false);
        this.pendingApprovals = [];
    }

    public async close(): Promise<void> {
        this.cancel();
        if (this.loopPromise)
            await this.loopPromise;
        await this.historyStore.flush();
        await this.mcpManager.close();
    }

    private async getSystemContext(): Promise<string> {
        try {
            const hostnamePromise = cockpit.spawn(["hostname"]).then(data => data.trim());
            const osReleaseFile = cockpit.file("/etc/os-release");
            const osReleasePromise = osReleaseFile.read().finally(() => osReleaseFile.close());
            const uptimePromise = cockpit.spawn(["uptime", "-p"]).then(data => data.trim());
            const [hostname, osRelease, uptime] = await Promise.all([
                hostnamePromise,
                osReleasePromise,
                uptimePromise
            ]);

            const match = osRelease?.match(/PRETTY_NAME="([^"]+)"/);
            const prettyName = match?.[1] || "Linux";
            const userInfo = cockpit.info.user;
            return `Hostname: ${hostname}
OS: ${prettyName}
Uptime: ${uptime}
Current Date: ${new Date().toLocaleString()}
Current User: ${userInfo.name} (id: ${userInfo.uid}; groups: ${userInfo.groups.join(", ")}; home: ${userInfo.home})
Running in Cockpit Web Console.`;
        } catch (error) {
            console.error("Error gathering system context:", error);
            return "System context unavailable.";
        }
    }

    private async setupConnection(): Promise<void> {
        const localServer = new McpServerLocal({
            allow_shell_access: this.settings.allowShellAccess
        });
        await localServer.init();

        const clientTransport = new LocalTransport();
        const serverTransport = new LocalTransport();
        clientTransport.connect(serverTransport);
        await localServer.connect(serverTransport);
        await this.mcpManager.connectServer({
            id: "builtin",
            name: "System Tools",
            transport: "local",
            enabled: true
        }, clientTransport);
        await this.mcpManager.refreshTools();

        const sysInfoPromise = this.getSystemContext();
        const customConnections = Promise.allSettled(
            this.settings.mcpServers
                    .filter(server => server.enabled)
                    .map(server => this.mcpManager.connectServer(server))
        ).then(() => this.mcpManager.refreshTools());
        const sysInfo = await sysInfoPromise;
        this.systemContext = `You are a Linux System Administrator Copilot running in Cockpit.
Your goal is to help the user manage this system safely and efficiently.

SYSTEM CONTEXT:
${sysInfo}

USER CUSTOM CONTEXT:
${this.settings.customSystemPrompt}

RULES:
1. You may use the provided tools to inspect and modify the system.
2. ALWAYS ask for confirmation before taking destructive actions.
3. Be concise. Use markdown for formatting.
4. If a tool call fails, analyze the error and suggest a fix.`;

        // Custom servers are optional and must not block first usable UI.
        customConnections.catch(error => console.error("MCP background setup failed:", error));
    }

    public async addUserMessage(content: string): Promise<void> {
        if (this.loopPromise)
            return;

        const message: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content
        };
        this.messages = [...this.messages, message];
        this.onUpdate(this.messages);
        await this.startLoop();
    }

    public async regenerateLastResponse(): Promise<void> {
        if (this.loopPromise)
            return;

        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage?.role !== "assistant")
            return;
        this.messages = this.messages.slice(0, -1);
        this.pendingApprovals = [];
        this.onUpdate(this.messages);
        await this.startLoop();
    }

    private async startLoop(): Promise<void> {
        if (this.loopPromise)
            return this.loopPromise;
        const loop = this.runLoop();
        this.loopPromise = loop;
        try {
            await loop;
        } finally {
            if (this.loopPromise === loop)
                this.loopPromise = null;
        }
    }

    public approveToolCall(toolCallId: string): void {
        const index = this.pendingApprovals.findIndex(approval => approval.toolCall.id === toolCallId);
        if (index === -1)
            return;
        const [approval] = this.pendingApprovals.splice(index, 1);
        approval.resolve(true);
        this.onUpdate(this.messages);
    }

    public rejectToolCall(toolCallId: string): void {
        const index = this.pendingApprovals.findIndex(approval => approval.toolCall.id === toolCallId);
        if (index === -1)
            return;
        const [approval] = this.pendingApprovals.splice(index, 1);
        approval.resolve(false);
        this.onUpdate(this.messages);
    }

    private buildContext(): ChatMessage[] {
        const recent = this.messages.length > MAX_CONTEXT_MESSAGES
            ? [
                {
                    id: "context-truncated",
                    role: "system" as const,
                    content: "Earlier messages were omitted to stay within the context budget."
                },
                ...this.messages.slice(-MAX_CONTEXT_MESSAGES)
            ]
            : this.messages;
        return [{ id: "sys", role: "system", content: this.systemContext }, ...recent];
    }

    private async runLoop(): Promise<void> {
        const controller = new AbortController();
        this.requestAbortController = controller;
        this.isProcessing = true;
        this.onUpdate(this.messages);

        try {
            for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
                const tools = await this.mcpManager.listAllTools(controller.signal);
                this.toolMetadata = new Map(tools.map(reference => [reference.tool.name, reference.tool]));
                const toolMap = new Map(tools.map(reference => [reference.tool.name, reference]));
                let partialContent = "";
                let updateTimer: ReturnType<typeof setTimeout> | undefined;
                const streamingMessage: ChatMessage = {
                    id: "streaming",
                    role: "assistant",
                    content: ""
                };
                const publishStreaming = () => {
                    updateTimer = undefined;
                    this.onUpdate([...this.messages, streamingMessage]);
                };

                const response = await this.llm.chatCompletion(
                    this.buildContext(),
                    tools.map(reference => reference.tool),
                    chunk => {
                        partialContent += chunk;
                        streamingMessage.content = partialContent;
                        if (!updateTimer)
                            updateTimer = setTimeout(publishStreaming, STREAM_UPDATE_INTERVAL_MS);
                    },
                    controller.signal
                );
                if (updateTimer)
                    clearTimeout(updateTimer);
                this.messages = [...this.messages, response];
                this.onUpdate(this.messages);

                if (!response.toolCalls?.length)
                    break;

                const resultMessages: ChatMessage[] = [];
                for (const call of response.toolCalls) {
                    const reference = toolMap.get(call.function.name);
                    const approved = reference?.tool._meta?.isLowRisk
                        ? true
                        : await this.waitForApproval(call);
                    let output: string;
                    if (!approved) {
                        output = "User rejected tool execution.";
                    } else if (!reference) {
                        output = `Error: Tool '${call.function.name}' not found.`;
                    } else {
                        try {
                            output = await this.mcpManager.callTool(
                                reference.serverId,
                                reference.originalName,
                                safeJsonParse(call.function.arguments),
                                controller.signal
                            );
                        } catch (error) {
                            output = `Error executing tool: ${error}`;
                        }
                    }
                    resultMessages.push({
                        id: crypto.randomUUID(),
                        role: "tool",
                        content: output,
                        toolResult: {
                            toolCallId: call.id,
                            output,
                            name: call.function.name
                        }
                    });
                }
                this.messages = [...this.messages, ...resultMessages];
                this.onUpdate(this.messages);

                if (iteration === MAX_TOOL_ITERATIONS - 1) {
                    this.messages = [...this.messages, {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: "Tool execution stopped after reaching the maximum number of steps."
                    }];
                    this.onUpdate(this.messages);
                }
            }
        } catch (error) {
            if (!isAbortError(error)) {
                console.error("Agent loop error:", error);
                this.messages = [...this.messages, {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: `Error: ${error}`
                }];
                this.onUpdate(this.messages);
            }
        } finally {
            this.requestAbortController = null;
            this.pendingApprovals = [];
            this.isProcessing = false;
            this.onUpdate(this.messages);
            try {
                await this.saveCurrentChat();
                await this.historyStore.flush();
            } catch (persistenceError) {
                console.error("Failed to persist chat history:", persistenceError);
            }
        }
    }

    private waitForApproval(toolCall: ToolCall): Promise<boolean> {
        return new Promise(resolve => {
            this.pendingApprovals.push({ toolCall, resolve });
            this.onUpdate(this.messages);
        });
    }

    public getToolDisplayName(fullName: string): string {
        return this.toolMetadata.get(fullName)?.title || formatToolName(fullName);
    }
}
