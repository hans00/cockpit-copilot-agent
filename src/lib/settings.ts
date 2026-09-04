/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { CopilotSettings, DEFAULT_SETTINGS, McpServerConfig } from "./types.js";
import { ensureCockpitReady } from "./cockpit-ready.js";

const SETTINGS_FILE_PATH = "/etc/cockpit/copilot-settings.json";

const cloneDefaultSettings = (): CopilotSettings => ({
    llm: { ...DEFAULT_SETTINGS.llm },
    mcpServers: [],
    customSystemPrompt: DEFAULT_SETTINGS.customSystemPrompt,
    allowShellAccess: DEFAULT_SETTINGS.allowShellAccess
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const isProvider = (value: unknown): value is CopilotSettings["llm"]["provider"] =>
    ["openai", "anthropic", "ollama", "gemini", "openrouter", "custom"].includes(String(value));

const normalizeSettings = (loaded: unknown): CopilotSettings => {
    const result = cloneDefaultSettings();
    if (!isRecord(loaded))
        return result;

    const llm = isRecord(loaded.llm) ? loaded.llm : {};
    if (isProvider(llm.provider)) result.llm.provider = llm.provider;
    if (typeof llm.apiKey === "string") result.llm.apiKey = llm.apiKey;
    if (typeof llm.baseUrl === "string") result.llm.baseUrl = llm.baseUrl;
    if (typeof llm.model === "string") result.llm.model = llm.model;
    if (typeof loaded.customSystemPrompt === "string") result.customSystemPrompt = loaded.customSystemPrompt;
    if (typeof loaded.allowShellAccess === "boolean") result.allowShellAccess = loaded.allowShellAccess;
    if (Array.isArray(loaded.mcpServers)) {
        result.mcpServers = loaded.mcpServers.flatMap(value => {
            if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" ||
                typeof value.enabled !== "boolean" || !["stdio", "http", "local"].includes(String(value.transport)))
                return [];

            const server: McpServerConfig = {
                id: value.id,
                name: value.name,
                transport: value.transport as McpServerConfig["transport"],
                enabled: value.enabled
            };
            if (typeof value.command === "string") server.command = value.command;
            if (typeof value.url === "string") server.url = value.url;
            if (Array.isArray(value.args)) {
                const args = value.args.filter((arg): arg is string => typeof arg === "string");
                if (args.length > 0) server.args = args;
            }
            return [server];
        });
    }
    return result;
};

export async function loadSettings(): Promise<CopilotSettings> {
    await ensureCockpitReady();
    const file = cockpit.file(SETTINGS_FILE_PATH, { superuser: "try" });
    try {
        const content = await file.read();

        if (!content) {
            return cloneDefaultSettings();
        }

        return normalizeSettings(JSON.parse(content));
    } catch (error) {
        console.error("Failed to load settings:", error);
        return cloneDefaultSettings();
    } finally {
        file.close();
    }
}

export async function saveSettings(settings: CopilotSettings): Promise<void> {
    await ensureCockpitReady();
    const file = cockpit.file(SETTINGS_FILE_PATH, { superuser: "try" });
    try {
        // Keep the shared settings file free of credentials. API keys live in
        // the separate shared credentials file and are injected at runtime.
        const llmWithoutKey: Partial<CopilotSettings["llm"]> = { ...settings.llm };
        delete llmWithoutKey.apiKey;
        await file.replace(JSON.stringify({ ...settings, llm: llmWithoutKey }, null, 2));
    } catch (error) {
        console.error("Failed to save settings:", error);
        throw error;
    } finally {
        file.close();
    }
}
