/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { execute, formatResult, run } from "./exec.js";

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
    load: string;
    status: string;
    sub: string;
    description: string;
}

/**
 * Parse `systemctl list-units --plain --no-legend` output.
 *
 * Without --plain, systemctl prefixes failed and not-found units with a
 * status bullet, which shifts every column; tolerate it anyway in case
 * the output comes from elsewhere.
 */
export function parseUnitList(output: string): UnitInfo[] {
    const units: UnitInfo[] = [];
    for (const line of output.split("\n")) {
        const cleaned = line.trim().replace(/^[●*×○]\s+/, "");
        const parts = cleaned.split(/\s+/);
        if (!parts[0])
            continue;
        units.push({
            unit: parts[0],
            load: parts[1] || "unknown",
            status: parts[2] || "unknown",
            sub: parts[3] || "unknown",
            description: parts.slice(4).join(" ")
        });
    }
    return units;
}

export async function listUnits(scope: "system" | "user" = "system"): Promise<UnitInfo[]> {
    try {
        const args = ["systemctl", "list-units", "--type=service", "--all", "--plain", "--no-pager", "--no-legend"];
        if (scope === "user") {
            args.splice(1, 0, "--user");
        }
        return parseUnitList(await cockpit.spawn(args));
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

const scoped = (args: string[], scope: "system" | "user"): string[] =>
    scope === "user" ? [args[0], "--user", ...args.slice(1)] : args;

export async function listFailed(scope: "system" | "user" = "system"): Promise<UnitInfo[] | string> {
    const result = await execute(scoped(["systemctl", "list-units", "--failed", "--all", "--plain", "--no-pager", "--no-legend"], scope));
    if (result.exitCode !== 0 || result.problem !== undefined)
        return formatResult(result);
    return parseUnitList(result.output);
}

export async function listTimers(scope: "system" | "user" = "system"): Promise<string> {
    return await run(scoped(["systemctl", "list-timers", "--all", "--no-pager"], scope));
}

export async function catUnit(unit: string, scope: "system" | "user" = "system"): Promise<string> {
    return await run(scoped(["systemctl", "cat", "--no-pager", "--", unit], scope));
}

export async function listDependencies(unit: string, reverse: boolean, scope: "system" | "user" = "system"): Promise<string> {
    const args = ["systemctl", "list-dependencies", "--no-pager", "--plain"];
    if (reverse)
        args.push("--reverse");
    return await run(scoped([...args, "--", unit], scope));
}
