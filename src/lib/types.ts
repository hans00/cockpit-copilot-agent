/* SPDX-License-Identifier: LGPL-2.1-or-later */
export interface McpTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema: {
        type: "object";
        properties?: Record<string, unknown>;
        required?: string[];
    };
}

export interface McpServerConfig {
    id: string; // uuid
    name: string; // e.g. "My DB Tools"
    transport: "stdio" | "http" | "local";
    command?: string; // for stdio: e.g. "python3"
    args?: string[]; // for stdio: e.g. ["/opt/my-tools/server.py"]
    url?: string; // for http: e.g. "http://localhost:3000/sse"
    enabled: boolean;
}

export interface CopilotSettings {
    llm: {
        provider: "openai" | "anthropic" | "ollama" | "gemini" | "openrouter" | "custom";
        apiKey: string;
        baseUrl: string;
        model: string;
    };
    mcpServers: McpServerConfig[];
    customSystemPrompt: string;
}

export const DEFAULT_SETTINGS: CopilotSettings = {
    llm: {
        provider: "openai",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o"
    },
    mcpServers: [],
    customSystemPrompt: ""
};

export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string; // JSON string
    };
    extra_content?: unknown; // For Gemini/Google extra metadata
}

export interface ToolResult {
    toolCallId: string;
    output: string;
    isError?: boolean;
    name?: string; // tool name
}

export interface ChatMessage {
    id: string;
    role: "system" | "user" | "assistant" | "tool";
    content: string; // basic text content
    toolCalls?: ToolCall[];
    toolResult?: ToolResult;
}
