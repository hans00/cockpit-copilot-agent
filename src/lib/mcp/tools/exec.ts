/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit, { SpawnOptions } from "cockpit";

export interface CommandResult {
    exitCode: number;
    output: string;
    // Set when the process could not run at all (not found, access denied...)
    problem?: string;
}

/**
 * Run a command and always resolve with its output and exit status.
 *
 * cockpit.spawn() rejects on a non-zero exit and drops the output, which
 * hides exactly the information needed to diagnose a failure. Output is
 * collected through the stream callback so it survives the rejection.
 */
export async function execute(argv: string[], options: SpawnOptions = {}): Promise<CommandResult> {
    let output = "";
    const process = cockpit.spawn(argv, { err: "out", ...options, binary: false });
    process.stream((data: string) => {
        output += data;
    });
    try {
        await process;
        return { exitCode: 0, output };
    } catch (error: unknown) {
        const details = (error && typeof error === "object" ? error : {}) as {
            exit_status?: number | null;
            problem?: string | null;
            message?: string;
        };
        if (typeof details.exit_status === "number")
            return { exitCode: details.exit_status, output };
        return {
            exitCode: -1,
            output,
            problem: details.problem || details.message || String(error)
        };
    }
}

/** Render a command result for the model, keeping failures explicit. */
export function formatResult(result: CommandResult): string {
    const output = result.output.replace(/\s+$/, "");
    if (result.problem !== undefined)
        return `${output ? output + "\n" : ""}[failed to run: ${result.problem}]`;
    if (result.exitCode !== 0)
        return `${output ? output + "\n" : ""}[exit code: ${result.exitCode}]`;
    return output || "(no output)";
}

export async function run(argv: string[], options: SpawnOptions = {}): Promise<string> {
    return formatResult(await execute(argv, options));
}
