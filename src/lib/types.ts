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
    _meta?: {
        isLowRisk?: boolean; // If true, tool can be auto-approved
    };
}

export interface ToolRegistration {
    serverId: string;
    originalName: string;
    // True only for the in-process system tools shipped with this package.
    builtin: boolean;
    tool: McpTool;
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
    allowShellAccess: boolean;
    // Maximum model/tool round trips per request before asking to continue.
    maxToolSteps: number;
}

export const MIN_TOOL_STEPS = 1;
export const MAX_TOOL_STEPS = 100;

export const DEFAULT_SETTINGS: CopilotSettings = {
    llm: {
        provider: "openai",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o"
    },
    mcpServers: [],
    customSystemPrompt: "",
    allowShellAccess: false,
    maxToolSteps: 25
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
    // Set on the assistant notice added when the step limit is reached.
    notice?: "step-limit";
}

export interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    lastModified: number;
    messageCount?: number;
    loadedMessageCount?: number;
}

export type ChatSessionSummary = Omit<ChatSession, "messages">;
