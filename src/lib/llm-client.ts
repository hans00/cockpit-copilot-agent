/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit, { Spawn } from "cockpit";
import OpenAI from "openai";
import { ChatMessage, ToolCall, McpTool } from "./types.js";

const genId = (prefix: string) =>
    `${prefix}_${Math.random().toString(36)
            .substring(2, 9)}`;

interface LlmConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    useHostProxy?: boolean;
}

const LLM_REQUEST_TIMEOUT_MS = 120000;
const HOST_LLM_PROXY_PATH = "/usr/libexec/cockpit-copilot-agent-llm-proxy";

interface PartialToolCall {
    id: string;
    name: string;
    args: string;
    extraContent?: unknown;
}

interface HostEvent {
    type: string;
    content?: string;
    index?: number;
    id?: string;
    name?: string;
    arguments?: string;
    extra_content?: unknown;
    error?: string;
}

interface HostRequest {
    api_key: string;
    base_url: string;
    model: string;
    messages: unknown[];
    tools: unknown[];
}

export class LlmClient {
    private client: OpenAI;
    private model: string;
    private apiKey: string;
    private baseUrl: string;
    private useHostProxy: boolean;

    constructor(config: LlmConfig) {
        this.client = new OpenAI({
            apiKey: config.apiKey || "dummy", // Ollama doesn't need key
            baseURL: config.baseUrl,
            dangerouslyAllowBrowser: true, // Running in cockpit browser context
            defaultHeaders: {
                'x-stainless-arch': null,
                'x-stainless-lang': null,
                'x-stainless-os': null,
                'x-stainless-package-version': null,
                'x-stainless-retry-count': null,
                'x-stainless-runtime': null,
                'x-stainless-runtime-version': null,
                'x-stainless-timeout': null,
            }
        });
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.model = config.model;
        this.useHostProxy = config.useHostProxy === true;
    }

    async chatCompletion(
        messages: ChatMessage[],
        tools: McpTool[],
        onChunk?: (chunk: string) => void,
        signal?: AbortSignal
    ): Promise<ChatMessage> {
        // Convert internal messages to OpenAI messages
        const openAiMessages = messages.map(msg => {
            if (msg.role === "tool") {
                return {
                    role: "tool",
                    tool_call_id: msg.toolResult?.toolCallId,
                    content: msg.toolResult?.output || "",
                    name: msg.toolResult?.name
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
                        },
                        ...(tc.extra_content ? { extra_content: tc.extra_content } : {})
                    }))
                };
            }
            return {
                role: msg.role,
                content: msg.content
            };
        });

        const toolsBody = tools.map(t => ({
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

        const requestPayload = {
            api_key: this.apiKey,
            base_url: this.baseUrl,
            model: this.model,
            messages: openAiMessages,
            tools: openAiTools || []
        };

        if (this.useHostProxy) {
            return this.chatCompletionViaHost(requestPayload, onChunk, signal);
        }

        try {
            const stream = await this.client.chat.completions.create({
                model: this.model,
                messages: openAiMessages as unknown as [],
                tools: openAiTools as unknown as [],
                stream: true,
            }, {
                signal,
                timeout: LLM_REQUEST_TIMEOUT_MS
            });

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
                        const idx = tc.index ?? toolCallsMap.size;
                        if (!toolCallsMap.has(idx)) {
                            toolCallsMap.set(idx, { id: "", name: "", args: "" });
                        }
                        const current = toolCallsMap.get(idx);
                        if (current) {
                            if (tc.id) current.id = tc.id;
                            if (tc.function?.name) current.name = tc.function.name;
                            if (tc.function?.arguments) current.args += tc.function.arguments;
                            const extraContent = (tc as typeof tc & { extra_content?: unknown }).extra_content;
                            if (extraContent)
                                current.extraContent = extraContent;
                        }
                    }
                }
            }

            const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
                id: tc.id || genId("call"),
                function: {
                    name: tc.name,
                    arguments: tc.args
                },
                extra_content: tc.extraContent
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

    private async chatCompletionViaHost(
        requestPayload: HostRequest,
        onChunk?: (chunk: string) => void,
        signal?: AbortSignal
    ): Promise<ChatMessage> {
        const process: Spawn<string> = cockpit.spawn([HOST_LLM_PROXY_PATH], { pty: false });
        const toolCalls = new Map<number, PartialToolCall>();
        let content = "";
        let buffer = "";
        let settled = false;

        const buildMessage = (): ChatMessage => {
            const calls: ToolCall[] = Array.from(toolCalls.values()).map(call => ({
                id: call.id || genId("call"),
                function: {
                    name: call.name,
                    arguments: call.args
                },
                ...(call.extraContent !== undefined ? { extra_content: call.extraContent } : {})
            }));
            return calls.length > 0
                ? { id: `msg_${Date.now()}`, role: "assistant", content, toolCalls: calls }
                : { id: `msg_${Date.now()}`, role: "assistant", content };
        };

        const response = new Promise<ChatMessage>((resolve, reject) => {
            const finish = (error?: Error) => {
                if (settled)
                    return;
                settled = true;
                if (error)
                    reject(error);
                else
                    resolve(buildMessage());
            };
            const handleEvent = (event: HostEvent) => {
                if (event.type === "delta" && event.content) {
                    content += event.content;
                    onChunk?.(event.content);
                } else if (event.type === "tool_call") {
                    const index = event.index || 0;
                    const call = toolCalls.get(index) || { id: "", name: "", args: "" };
                    if (event.id) call.id = event.id;
                    if (event.name) call.name = event.name;
                    if (event.arguments) call.args += event.arguments;
                    if (event.extra_content !== undefined) call.extraContent = event.extra_content;
                    toolCalls.set(index, call);
                } else if (event.type === "error") {
                    finish(new Error(event.error || "Host LLM proxy failed"));
                } else if (event.type === "done") {
                    finish();
                }
            };
            const parseBuffer = () => {
                let newline: number;
                while ((newline = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, newline).trim();
                    buffer = buffer.slice(newline + 1);
                    if (!line)
                        continue;
                    try {
                        handleEvent(JSON.parse(line) as HostEvent);
                    } catch (error) {
                        finish(error instanceof Error ? error : new Error(String(error)));
                    }
                }
            };

            process.stream(data => {
                buffer += data;
                parseBuffer();
            });
            process.done(() => {
                parseBuffer();
                finish();
            });
            process.fail(error => finish(error));

            if (signal?.aborted) {
                process.close();
                finish(new DOMException("Request aborted", "AbortError"));
                return;
            }
            signal?.addEventListener("abort", () => process.close(), { once: true });
            process.input(JSON.stringify(requestPayload));
        });

        return response;
    }
}
