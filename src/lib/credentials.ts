/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ensureCockpitReady } from "./cockpit-ready.js";

const CREDENTIALS_FILE_PATH = "/etc/cockpit/copilot.credentials.json";

export interface Credentials {
    apiKey: string;
    baseUrl?: string;
    provider?: string;
    model?: string;
}

export async function readCredentials(): Promise<Credentials> {
    await ensureCockpitReady();
    const file = cockpit.file(CREDENTIALS_FILE_PATH, { superuser: "try" });
    try {
        // Must use superuser: "try" to read root-owned file
        const content = await file.read();
        if (!content) return { apiKey: "" };
        const loaded = JSON.parse(content) as Partial<Credentials>;
        return {
            apiKey: typeof loaded.apiKey === "string" ? loaded.apiKey : ""
        };
    } catch (error) {
        console.warn("Could not read credentials file:", error);
        return { apiKey: "" };
    } finally {
        file.close();
    }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
    await ensureCockpitReady();
    const file = cockpit.file(CREDENTIALS_FILE_PATH, { superuser: "try" });
    try {
        // The credential is intentionally system-wide and shared by all authorized users.
        await file.replace(JSON.stringify({ apiKey: creds.apiKey }, null, 2));
    } catch (error) {
        console.error("Failed to write credentials:", error);
        throw error;
    } finally {
        file.close();
    }

    // Ensure secure permissions after the file handle has been closed.
    await cockpit.spawn(["chmod", "600", CREDENTIALS_FILE_PATH], { superuser: "try" });
}
