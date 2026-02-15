import cockpit from "cockpit";
import { ChatMessage, CopilotSettings, ToolCall, McpTool, ChatSession, ChatSessionSummary } from "./types.js";
import { LlmClient } from "./llm-client.js";
import { McpClientManager } from "./mcp-client.js";
import { McpServerLocal } from "./mcp/mcp-server-local.js";
import { LocalTransport } from "./mcp/local-transport.js";

type UpdateCallback = (messages: ChatMessage[]) => void;

// abc_def__ghi -> Abc Def: Ghi
const formatToolName = (name: string) =>
    name.replace(/__/g, ": ").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())

function safeJsonParse(str: string) {
    try {
        return JSON.parse(str);
    } catch {
        return { error: "Invalid JSON arguments" };
    }
}

type ChatID = string;

export class Agent {
    private settings: CopilotSettings;
    private llm: LlmClient;
    private mcpManager: McpClientManager;
    private messages: ChatMessage[] = [];
    private onUpdate: UpdateCallback;
    private systemContext: string = "";
    public isProcessing: boolean = false;
    private toolMetadata: Map<string, McpTool> = new Map();

    private history: Record<string, ChatSessionSummary> = {};
    public currentChatId: string | null = null;

    public pendingApprovals: {
        toolCall: ToolCall,
        resolve: (value: boolean) => void,
        reject: (reason?: unknown) => void
    }[] = [];

    constructor(settings: CopilotSettings, mcpManager: McpClientManager, onUpdate: UpdateCallback) {
        this.settings = settings;
        this.mcpManager = mcpManager;
        this.onUpdate = onUpdate;

        this.llm = new LlmClient({
            apiKey: settings.llm.apiKey, // This needs to be loaded from credentials separately or passed in
            baseUrl: settings.llm.baseUrl,
            model: settings.llm.model
        });
    }

    // Initialize: load system context, connect MCP servers
    async init() {
        await cockpit.init();
        await this.ensureHistoryDir();
        await this.migrateHistory();
        await this.loadHistoryIndex();

        if (Object.keys(this.history).length === 0) {
            await this.createChat();
        } else {
            // Switch to most recent
            const recent = Object.values(this.history).sort((a, b) => b.lastModified - a.lastModified)[0];
            await this.switchToChat(recent.id);
        }
        await this.setupConnection();
    }

    public getHistory() {
        return Object.values(this.history).sort((a, b) => b.lastModified - a.lastModified);
    }

    private get historyDir() {
        return `${cockpit.info.user.home}/.local/share/cockpit/copilot-chats`;
    }

    private async ensureHistoryDir() {
        try {
            await cockpit.spawn(["mkdir", "-p", this.historyDir]);
        } catch (e) {
            console.error("Failed to create history dir", e);
        }
    }

    private async migrateHistory() {
        const oldHistoryPath = `${cockpit.info.user.home}/.local/share/cockpit/copilot-history.json`;
        try {
            const file = cockpit.file(oldHistoryPath);
            const content = await file.read();
            if (content) {
                const oldHistory: Record<string, ChatSession> = JSON.parse(content);
                // Migrate each chat
                for (const [id, session] of Object.entries(oldHistory)) {
                    await this.saveChat(session);
                    this.history[id] = {
                         id: session.id,
                         title: session.title,
                         lastModified: session.lastModified
                    };
                }
                await this.saveHistoryIndex();
                // Rename old file to avoid re-migration
                await cockpit.spawn(["mv", oldHistoryPath, `${oldHistoryPath}.bak`]);
            }
        } catch (e) {
            // No old history or invalid
        }
    }

    private async loadHistoryIndex() {
        try {
            const indexPath = `${this.historyDir}/index.json`;
            const file = cockpit.file(indexPath);
            const content = await file.read();
            if (content) {
                this.history = JSON.parse(content);
            }
        } catch {
            this.history = {};
        }
    }

    private async saveHistoryIndex() {
        const indexPath = `${this.historyDir}/index.json`;
        const file = cockpit.file(indexPath);
        await file.replace(JSON.stringify(this.history));
    }

    private async loadChat(id: string): Promise<ChatSession | null> {
        try {
            const chatPath = `${this.historyDir}/${id}.json`;
            const file = cockpit.file(chatPath);
            const content = await file.read();
            if (content) {
                return JSON.parse(content);
            }
        } catch {
            return null;
        }
        return null;
    }

    private async saveChat(session: ChatSession) {
        const chatPath = `${this.historyDir}/${session.id}.json`;
        const file = cockpit.file(chatPath);
        await file.replace(JSON.stringify(session));
    }

    public async createChat() {
        const id = crypto.randomUUID();
        const session: ChatSession = {
            id,
            title: "New Chat",
            messages: [],
            lastModified: Date.now()
        };
        
        await this.saveChat(session);
        
        this.history[id] = {
            id,
            title: session.title,
            lastModified: session.lastModified
        };
        
        await this.saveHistoryIndex();
        await this.switchToChat(id);
        return id;
    }

    public async switchToChat(id: string) {
        if (this.history[id]) {
            this.currentChatId = id;
            const session = await this.loadChat(id);
            if (session) {
                this.messages = session.messages;
            } else {
                this.messages = [];
            }
            this.onUpdate(this.messages);
        }
    }

    public async deleteChat(id: string) {
        delete this.history[id];
        if (this.currentChatId === id) {
            this.currentChatId = null;
            this.messages = [];
            this.onUpdate([]);
            
            // Try to switch to another chat
            const remaining = Object.values(this.history).sort((a, b) => b.lastModified - a.lastModified);
            if (remaining.length > 0) {
                 await this.switchToChat(remaining[0].id);
            } else {
                 await this.createChat();
            }
        }
        await this.saveHistoryIndex();
        
        try {
             const chatPath = `${this.historyDir}/${id}.json`;
             await cockpit.spawn(["rm", "-f", chatPath]);
        } catch (e) {
            console.error("Failed to delete chat file", e);
        }
    }

    private async saveCurrentChat() {
        if (this.currentChatId && this.history[this.currentChatId]) {
            const session: ChatSession = {
                id: this.currentChatId,
                title: this.history[this.currentChatId].title,
                messages: this.messages,
                lastModified: Date.now()
            };

            // Auto-title if it's "New Chat" and we have messages
            if (session.title === "New Chat" && this.messages.length > 0) {
                 const firstMsg = this.messages.find(m => m.role === 'user');
                 if (firstMsg) {
                     session.title = firstMsg.content.slice(0, 30) + (firstMsg.content.length > 30 ? "..." : "");
                 }
            }

            // Update in-memory index
            this.history[this.currentChatId].title = session.title;
            this.history[this.currentChatId].lastModified = session.lastModified;

            await this.saveChat(session);
            await this.saveHistoryIndex();
        }
    }

    public async reconfigure(newSettings: CopilotSettings) {
        this.settings = newSettings;

        // Re-init LLM with new settings
        this.llm = new LlmClient({
            apiKey: newSettings.llm.apiKey,
            baseUrl: newSettings.llm.baseUrl,
            model: newSettings.llm.model
        });

        // Close existing connections
        await this.mcpManager.close();

        // Re-connect
        await this.setupConnection();
    }

    private async getSystemContext(): Promise<string> {
        try {
            const hostname = await cockpit.spawn(["hostname"]).then(data => data.trim());
            const osRelease = await cockpit.file("/etc/os-release").read();
    
            let prettyName = "Linux";
            if (osRelease) {
                const match = osRelease.match(/PRETTY_NAME="([^"]+)"/);
                if (match) prettyName = match[1];
            }
    
            const uptime = await cockpit.spawn(["uptime", "-p"]).then(data => data.trim());
            const userInfo = cockpit.info.user;
    
            return `Hostname: ${hostname}
    OS: ${prettyName}
    Uptime: ${uptime}
    Current Date: ${new Date().toLocaleString('en-US')}
    Current User: ${userInfo.name} (id: ${userInfo.uid}; groups: ${userInfo.groups.join(", ")}; home: ${userInfo.home})
    Running in Cockpit Web Console.
    `;
        } catch (e) {
            console.error("Error gathering system context:", e);
            return "System context unavailable.";
        }
    }

    private async setupConnection() {
        // Initialize local server
        const localServer = new McpServerLocal({
            allow_shell_access: this.settings.allowShellAccess
        });
        await localServer.init();

        const clientTransport = new LocalTransport();
        const serverTransport = new LocalTransport();
        clientTransport.connect(serverTransport);

        // Start server with its transport
        // We need to wait for it or just start it. localServer.connect(serverTransport) is async
        await localServer.connect(serverTransport);

        // Connect to built-in local server
        await this.mcpManager.connectServer({
            id: "builtin",
            name: "System Tools",
            transport: "local",
            enabled: true
        }, clientTransport);

        // Connect custom servers from settings
        for (const s of this.settings.mcpServers) {
            if (s.enabled) {
                await this.mcpManager.connectServer(s);
            }
        }

        const sysInfo = await this.getSystemContext();
        this.systemContext = `
You are a Linux System Administrator Copilot running in Cockpit.
Your goal is to help the user manage this system safely and efficiently.

SYSTEM CONTEXT:
${sysInfo}

USER CUSTOM CONTEXT:
${this.settings.customSystemPrompt}

RULES:
1. You may use the provided tools to inspect and modify the system.
2. ALWAYS ask for confirmation before taking destructive actions (though the system will enforce approval).
3. Be concise. Use markdown for formatting.
4. If a tool call fails, analyze the error and suggest a fix.
`;
    }


    async addUserMessage(content: string) {
        const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content
        };
        this.messages = [...this.messages, msg];
        this.onUpdate(this.messages);
        await this.saveCurrentChat();

        await this.runLoop();
    }

    public async regenerateLastResponse() {
        if (this.isProcessing) return;

        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
            // Remove last assistant message
            this.messages = this.messages.slice(0, -1);
            
            // Clear any pending approvals since we are backtracking
            this.pendingApprovals = [];
            
            this.onUpdate(this.messages);
            await this.runLoop();
        }
    }

    // Resume loop after approval
    public approveToolCall(toolCallId: string) {
        const index = this.pendingApprovals.findIndex(p => p.toolCall.id === toolCallId);
        if (index !== -1) {
            const approval = this.pendingApprovals[index];
            this.pendingApprovals.splice(index, 1);
            approval.resolve(true);
            this.onUpdate(this.messages);
        }
    }

    public rejectToolCall(toolCallId: string) {
        const index = this.pendingApprovals.findIndex(p => p.toolCall.id === toolCallId);
        if (index !== -1) {
            const approval = this.pendingApprovals[index];
            this.pendingApprovals.splice(index, 1);
            approval.resolve(false);
            this.onUpdate(this.messages);
        }
    }

    private async runLoop() {
        // Prepare context
        const contextMessages: ChatMessage[] = [
            { id: "sys", role: "system", content: this.systemContext },
            ...this.messages
        ];

        const tools = await this.mcpManager.listAllTools();
        const llmTools = tools.map((t) => t.tool);

        // Cache tool metadata for UI names
        for (const t of tools) {
            this.toolMetadata.set(t.tool.name, t.tool);
        }

        // Reset processing state before starting LLM to ensure transition
        this.isProcessing = false;
        this.onUpdate(this.messages);

        this.isProcessing = true;
        this.onUpdate(this.messages);

        try {
            // Placeholder for streaming response
            let partialContent = "";
            const streamingMessage: ChatMessage = {
                id: "streaming",
                role: "assistant",
                content: ""
            };

            // Call LLM
            const response = await this.llm.chatCompletion(contextMessages, llmTools, (chunk) => {
                partialContent += chunk;
                streamingMessage.content = partialContent;
                this.onUpdate([...this.messages, streamingMessage]);
            });

            this.isProcessing = false;
            this.onUpdate(this.messages);

            // Add Assistant response
            this.messages = [...this.messages, response];
            this.onUpdate(this.messages);

            // Handle Tool Calls
            if (response.toolCalls && response.toolCalls.length > 0) {
                // Prepare all tool calls for approval
                const toolPromises = response.toolCalls.map(async (call) => {
                    const toolName = call.function.name;
                    const toolArgs = safeJsonParse(call.function.arguments);

                    const toolDef = tools.find((t: any) => t.tool.name === toolName);
                    const isLowRisk = toolDef?.tool._meta?.isLowRisk ?? false;

                    let approved = false;

                    // Only auto-approve if explicitly marked as low risk
                    if (isLowRisk) {
                         approved = true;
                    } else {
                        // Ask for approval (pauses this specific tool execution)
                        approved = await new Promise<boolean>((resolve, reject) => {
                            this.pendingApprovals.push({ toolCall: call, resolve, reject });
                            this.onUpdate(this.messages);
                        });
                    }

                    let resultOutput = "";
                    if (approved) {
                        try {
                            // EXECUTE TOOL
                            if (toolDef) {
                                resultOutput = await this.mcpManager.callTool(toolDef.serverId, toolDef.originalName, toolArgs);
                            } else {
                                resultOutput = `Error: Tool '${toolName}' not found.`;
                            }
                        } catch (e) {
                            resultOutput = `Error executing tool: ${e}`;
                        }
                    } else {
                        resultOutput = "User rejected tool execution.";
                    }

                    return {
                        id: crypto.randomUUID(),
                        role: "tool" as const,
                        content: resultOutput,
                        toolResult: {
                            toolCallId: call.id,
                            output: resultOutput,
                            name: toolName
                        }
                    };
                });

                // Wait for all tools to be processed (approved/executed or rejected)
                const resultMessages = await Promise.all(toolPromises);
                
                // Append all results to history
                this.messages = [...this.messages, ...resultMessages];
                this.onUpdate(this.messages);

                // Recurse to handle any follow-up reasoning
                await this.runLoop();
            }
        } catch (e) {
            console.error("Agent Loop Error:", e);
            const errMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Error: ${e}`
            };
            this.messages = [...this.messages, errMsg];
            this.onUpdate(this.messages);
        } finally {
            this.isProcessing = false;
            this.onUpdate(this.messages);
            await this.saveCurrentChat();
        }
    }

    public getToolDisplayName(fullName: string): string {
        const metadata = this.toolMetadata.get(fullName);
        if (metadata?.title) {
            return metadata.title;
        }

        // Fallback: Clean up raw name
        return formatToolName(fullName);
    }
}
