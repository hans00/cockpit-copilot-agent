/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

const CREDENTIALS_FILE_PATH = "/etc/cockpit/copilot.credentials.json";

export interface Credentials {
    apiKey: string;
    baseUrl?: string;
    provider?: string;
    model?: string;
}

export async function readCredentials(): Promise<Credentials> {
    try {
        // Must use superuser: "try" to read root-owned file
        const file = cockpit.file(CREDENTIALS_FILE_PATH, { superuser: "try" });
        const content = await file.read();
        if (!content) return { apiKey: "" };
        return JSON.parse(content);
    } catch (error) {
        console.warn("Could not read credentials file:", error);
        return { apiKey: "" };
    }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
    try {
        const file = cockpit.file(CREDENTIALS_FILE_PATH, { superuser: "try" });
        await file.replace(JSON.stringify(creds, null, 2));

        // Ensure secure permissions
        await cockpit.spawn(["chmod", "600", CREDENTIALS_FILE_PATH], { superuser: "try" });
    } catch (error) {
        console.error("Failed to write credentials:", error);
        throw error;
    }
}
