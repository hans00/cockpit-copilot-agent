export interface McpTool {
    name: string;
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
    transport: "stdio" | "http";
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
        provider: "ollama",
        apiKey: "ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3"
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
}

export interface ToolResult {
    toolCallId: string;
    output: string;
    isError?: boolean;
}

export interface ChatMessage {
    id: string;
    role: "system" | "user" | "assistant" | "tool";
    content: string; // basic text content
    toolCalls?: ToolCall[];
    toolResult?: ToolResult;
}

export interface CockpitProcess {
    stream: (callback: (data: string) => void) => void;
    input: (data: string) => void;
    close: () => void;
    stderr: (callback: (data: string) => void) => void;
    on: (event: string, callback: (error?: unknown) => void) => void;
}
