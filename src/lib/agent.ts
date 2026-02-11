import { ChatMessage, CopilotSettings, ToolCall } from "./types.js";
import { LlmClient } from "./llm-client.js";
import { McpClientManager } from "./mcp-client.js";
import { getSystemContext } from "./system-context.js";

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

    public waitingForApproval: {
        toolCall: ToolCall,
        resolve: (value: boolean) => void,
        reject: (reason?: unknown) => void
    } | null = null;

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
        // Connect to built-in server
        await this.mcpManager.connectServer({
            id: "builtin",
            name: "System Tools",
            transport: "stdio",
            command: "python3",
            args: ["-m", "mcp_server", "--permissions", "admin"], // assume admin for now, should check cockpit.user
            enabled: true
        });

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
    async approveToolCall(toolCallId: string) {
        if (this.waitingForApproval && this.waitingForApproval.toolCall.id === toolCallId) {
            this.waitingForApproval.resolve(true);
            this.waitingForApproval = null;
            // The loop is already running (awaiting the promise), so it continues automatically
        }
    }

    async rejectToolCall(toolCallId: string) {
        if (this.waitingForApproval && this.waitingForApproval.toolCall.id === toolCallId) {
            this.waitingForApproval.resolve(false);
            this.waitingForApproval = null;
        }
    }

    private async runLoop() {
        // Prepare context
        const contextMessages: ChatMessage[] = [
            { id: "sys", role: "system", content: this.systemContext },
            ...this.messages
        ];

        const tools = await this.mcpManager.listAllTools();
        const llmTools = tools.map(t => t.tool);

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

            // Add Assistant response
            this.messages = [...this.messages, response];
            this.onUpdate(this.messages);

            // Handle Tool Calls
            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const call of response.toolCalls) {
                    const toolName = call.function.name;
                    const toolArgs = safeJsonParse(call.function.arguments);

                    // Ask for approval
                    const approved = await new Promise<boolean>((resolve, reject) => {
                        this.waitingForApproval = { toolCall: call, resolve, reject };
                        this.onUpdate(this.messages); // Trigger UI to show approval button
                    });

                    let resultOutput = "";
                    if (approved) {
                        try {
                            // EXECUTE TOOL
                            // We use the tool definition found earlier to route to the correct server
                            const toolDef = tools.find(t => t.tool.name === toolName);
                            if (toolDef) {
                                resultOutput = await this.mcpManager.callTool(toolDef.serverId, toolDef.originalName, toolArgs);
                            } else {
                                resultOutput = "Error: Tool not found.";
                            }
                        } catch (e) {
                            resultOutput = `Error executing tool: ${e}`;
                        }
                    } else {
                        resultOutput = "User rejected tool execution.";
                    }

                    // Append Result
                    const resultMsg: ChatMessage = {
                        id: crypto.randomUUID(),
                        role: "tool",
                        content: resultOutput,
                        toolResult: {
                            toolCallId: call.id,
                            output: resultOutput
                        }
                    };

                    this.messages = [...this.messages, resultMsg];
                    this.onUpdate(this.messages);
                }

                // Recursively run loop again to let LLM see results and comment
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
        }
    }
}
