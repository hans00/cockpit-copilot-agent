/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export interface UnitInfo {
    unit: string;
    status: string;
    description: string;
}

export async function listUnits(scope: "system" | "user" = "system"): Promise<UnitInfo[]> {
    try {
        const args = ["systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend"];
        if (scope === "user") {
            args.splice(1, 0, "--user");
        }
        const result = await cockpit.spawn(args);
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

export async function getStatus(unit: string, scope: "system" | "user" = "system"): Promise<string> {
    try {
        const args = ["systemctl", "status", unit, "--no-pager", "-l"];
        if (scope === "user") {
            args.splice(1, 0, "--user");
        }
        const result = await cockpit.spawn(args);
        return result;
    } catch (e: any) {
        // systemctl status returns non-zero for stopped services, but we still want the output
        if (e.stdout || e.stderr) {
            return e.stdout + e.stderr;
        }
        return `Error getting status: ${e.message || e}`;
    }
}

export async function manageService(unit: string, action: string, scope: "system" | "user" = "system"): Promise<string> {
    const allowed_actions = ["start", "stop", "restart", "reload", "enable", "disable"];
    if (!allowed_actions.includes(action)) {
        throw new Error(`Invalid action: ${action}`);
    }

    try {
        const args = ["systemctl", action, unit];
        const options: any = {};
        
        if (scope === "user") {
            args.splice(1, 0, "--user");
        } else {
            options.superuser = "require";
        }

        await cockpit.spawn(args, options);
        return `Successfully executed ${action} on ${unit}`;
    } catch (e: any) {
        return `Error: ${e.message || e.stderr || e}`;
    }
}
