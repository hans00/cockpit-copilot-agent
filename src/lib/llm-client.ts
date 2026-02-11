import OpenAI from "openai";
import { ChatMessage, ToolCall, McpTool } from "./types.js";

interface LlmConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export class LlmClient {
    private client: OpenAI;
    private model: string;

    constructor(config: LlmConfig) {
        this.client = new OpenAI({
            apiKey: config.apiKey || "dummy", // Ollama doesn't need key
            baseURL: config.baseUrl,
            dangerouslyAllowBrowser: true // Running in cockpit browser context
        });
        this.model = config.model;
    }

    async chatCompletion(
        messages: ChatMessage[],
        tools: McpTool[],
        onChunk?: (chunk: string) => void
    ): Promise<ChatMessage> {
        // Convert internal messages to OpenAI messages
        const openAiMessages = messages.map(msg => {
            if (msg.role === "tool") {
                return {
                    role: "tool",
                    tool_call_id: msg.toolResult?.toolCallId,
                    content: msg.toolResult?.output || ""
                };
            }
            if (msg.role === "assistant" && msg.toolCalls) {
                return {
                    role: "assistant",
                    content: msg.content || null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: "function",
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments
                        }
                    }))
                };
            }
            return {
                role: msg.role,
                content: msg.content
            };
        });

        const toolsBody = tools.map(t => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            type: "function" as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema
            }
        }));
        const openAiTools = tools.length > 0
            ? toolsBody
            : undefined;

        try {
            const stream = await this.client.chat.completions.create({
                model: this.model,
                messages: openAiMessages as unknown as [],
                tools: openAiTools as unknown as [],
                stream: true
            });

            interface PartialToolCall {
                id: string;
                name: string;
                args: string;
            }

            let fullContent = "";
            const toolCallsMap = new Map<number, PartialToolCall>();

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;

                if (delta?.content) {
                    fullContent += delta.content;
                    if (onChunk) onChunk(delta.content);
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallsMap.has(idx)) {
                            toolCallsMap.set(idx, { id: "", name: "", args: "" });
                        }
                        const current = toolCallsMap.get(idx);
                        if (current) {
                            if (tc.id) current.id = tc.id;
                            if (tc.function?.name) current.name = tc.function.name;
                            if (tc.function?.arguments) current.args += tc.function.arguments;
                        }
                    }
                }
            }

            const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
                id: tc.id || "call_" + Math.random().toString(36)
                        .substring(2, 9), // Ollama sometimes omits ID
                function: {
                    name: tc.name,
                    arguments: tc.args
                }
            }));

            const id = `msg_${Date.now()}`;

            if (toolCalls.length === 0) {
                return {
                    id,
                    role: "assistant",
                    content: fullContent,
                };
            } else {
                return {
                    id,
                    role: "assistant",
                    content: fullContent,
                    toolCalls
                };
            }
        } catch (e) {
            console.error("LLM Error:", e);
            throw e;
        }
    }
}
