import cockpit from "cockpit";
import { ChatMessage, CopilotSettings, ToolCall, McpTool } from "./types.js";
import { LlmClient } from "./llm-client.js";
import { McpClientManager } from "./mcp-client.js";
import { getSystemContext } from "./system-context.js";
import { McpServerLocal } from "./mcp/mcp-server-local.js";
import { LocalTransport } from "./mcp/local-transport.js";

type UpdateCallback = (messages: ChatMessage[]) => void;

function safeJsonParse(str: string) {
    try {
        return JSON.parse(str);
    } catch {
        return { error: "Invalid JSON arguments" };
    }
}

export class Agent {
    private settings: CopilotSettings;
    private llm: LlmClient;
    private mcpManager: McpClientManager;
    private messages: ChatMessage[] = [];
    private onUpdate: UpdateCallback;
    private systemContext: string = "";
    public isProcessing: boolean = false;
    private toolMetadata: Map<string, McpTool> = new Map();

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

        const sysInfo = await getSystemContext();
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

        await this.runLoop();
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

                    // Ask for approval (pauses this specific tool execution)
                    const approved = await new Promise<boolean>((resolve, reject) => {
                        this.pendingApprovals.push({ toolCall: call, resolve, reject });
                        this.onUpdate(this.messages);
                    });

                    let resultOutput = "";
                    if (approved) {
                        try {
                            // EXECUTE TOOL
                            const toolDef = tools.find((t: any) => t.tool.name === toolName);
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
        }
    }

    public getToolDisplayName(fullName: string): string {
        const metadata = this.toolMetadata.get(fullName);
        if (metadata?.title) {
            return metadata.title;
        }
        if (metadata?.description) {
            return metadata.description.split('\n')[0];
        }

        // Fallback: Clean up raw name
        const namePart = fullName.split("__").pop() || fullName;
        return namePart
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}
