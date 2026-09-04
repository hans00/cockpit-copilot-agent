/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

const errorDetails = (error: unknown): { message: string; output?: string } => {
    if (error && typeof error === "object") {
        const details = error as Record<string, unknown>;
        const output = [details.stdout, details.stderr].filter(value => typeof value === "string").join("");
        const result: { message: string; output?: string } = {
            message: typeof details.message === "string" ? details.message : String(error)
        };
        if (output)
            result.output = output;
        return result;
    }
    return { message: String(error) };
};

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
    } catch (e: unknown) {
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
    } catch (e: unknown) {
        // systemctl status returns non-zero for stopped services, but we still want the output
        const details = errorDetails(e);
        return details.output || `Error getting status: ${details.message}`;
    }
}

export async function manageService(unit: string, action: string, scope: "system" | "user" = "system"): Promise<string> {
    const allowed_actions = ["start", "stop", "restart", "reload", "enable", "disable"];
    if (!allowed_actions.includes(action)) {
        throw new Error(`Invalid action: ${action}`);
    }

    try {
        const args = ["systemctl", action, unit];
        if (scope === "user") {
            args.splice(1, 0, "--user");
        }

        const options = scope === "user" ? {} : { superuser: "require" as const };
        await cockpit.spawn(args, options);
        return `Successfully executed ${action} on ${unit}`;
    } catch (e: unknown) {
        return `Error: ${errorDetails(e).message}`;
    }
}
