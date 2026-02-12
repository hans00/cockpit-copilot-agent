/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { CopilotSettings, DEFAULT_SETTINGS } from "./types.js";

const SETTINGS_FILE_PATH = "/etc/cockpit/copilot-settings.json";

export async function loadSettings(): Promise<CopilotSettings> {
    try {
        const file = cockpit.file(SETTINGS_FILE_PATH, { superuser: "try" });
        const content = await file.read();

        if (!content) {
            return DEFAULT_SETTINGS;
        }

        const loaded = JSON.parse(content);
        // Merge with defaults to ensure all fields exist
        return {
            llm: { ...DEFAULT_SETTINGS.llm, ...loaded.llm },
            mcpServers: loaded.mcpServers || [],
            customSystemPrompt: loaded.customSystemPrompt || "",
            allowShellAccess: loaded.allowShellAccess ?? false
        };
    } catch (error) {
        console.error("Failed to load settings:", error);
        return DEFAULT_SETTINGS;
    }
}

export async function saveSettings(settings: CopilotSettings): Promise<void> {
    try {
        const file = cockpit.file(SETTINGS_FILE_PATH, { superuser: "try" });
        await file.replace(JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error("Failed to save settings:", error);
        throw error;
    }
}
