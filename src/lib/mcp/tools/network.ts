/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { execute, formatResult, run } from "./exec.js";

export async function getInfo(): Promise<string> {
    return await run(["ip", "-brief", "address"]);
}

export async function downloadFile(url: string, dest: string): Promise<string> {
    let cmd: string[];

    try {
        await cockpit.spawn(["which", "curl"]);
        // -f: treat HTTP errors (404, 500...) as failures instead of saving the error page
        cmd = ["curl", "-fsSL", "-o", dest, url];
    } catch {
        try {
            await cockpit.spawn(["which", "wget"]);
            cmd = ["wget", "-O", dest, url];
        } catch {
            return "Error: neither curl nor wget found.";
        }
    }

    const result = await execute(cmd);
    if (result.exitCode === 0 && result.problem === undefined)
        return `Successfully downloaded ${url} to ${dest}`;
    return `Error downloading file:\n${formatResult(result)}`;
}
