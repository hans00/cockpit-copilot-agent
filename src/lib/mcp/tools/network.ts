/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export async function getInfo(): Promise<string> {
    try {
        return await cockpit.spawn(["ip", "-brief", "address"]);
    } catch (e: unknown) {
        return `Error getting network info: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function downloadFile(url: string, dest: string): Promise<string> {
    let cmd: string[];

    try {
        await cockpit.spawn(["which", "curl"]);
        cmd = ["curl", "-L", "-o", dest, url];
    } catch {
        try {
            await cockpit.spawn(["which", "wget"]);
            cmd = ["wget", "-O", dest, url];
        } catch {
            return "Error: neither curl nor wget found.";
        }
    }

    try {
        await cockpit.spawn(cmd);
        return `Successfully downloaded ${url} to ${dest}`;
    } catch (e: unknown) {
        return `Error downloading file: ${e instanceof Error ? e.message : String(e)}`;
    }
}
