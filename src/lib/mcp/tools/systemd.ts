/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export interface UnitInfo {
    unit: string;
    status: string;
    description: string;
}

export async function listUnits(): Promise<UnitInfo[]> {
    try {
        const result = await cockpit.spawn(["systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend"]);
        const units: UnitInfo[] = [];
        
        for (const line of result.split("\n")) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 1 && parts[0]) {
                const unit_name = parts[0];
                const status = parts[2] || "unknown";
                const desc = parts.slice(4).join(" ") || "";
                units.push({ unit: unit_name, status, description: desc });
            }
        }
        return units;
    } catch (e: any) {
        console.error("Error listing units:", e);
        return [];
    }
}

export async function getStatus(unit: string): Promise<string> {
    try {
        const result = await cockpit.spawn(["systemctl", "status", unit, "--no-pager", "-l"]);
        return result;
    } catch (e: any) {
        // systemctl status returns non-zero for stopped services, but we still want the output
        if (e.stdout || e.stderr) {
            return e.stdout + e.stderr;
        }
        return `Error getting status: ${e.message || e}`;
    }
}

export async function manageService(unit: string, action: string): Promise<string> {
    const allowed_actions = ["start", "stop", "restart", "reload", "enable", "disable"];
    if (!allowed_actions.includes(action)) {
        throw new Error(`Invalid action: ${action}`);
    }

    try {
        await cockpit.spawn(["systemctl", action, unit], { superuser: "require" });
        return `Successfully executed ${action} on ${unit}`;
    } catch (e: any) {
        return `Error: ${e.message || e.stderr || e}`;
    }
}
