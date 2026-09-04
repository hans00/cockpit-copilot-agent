/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export async function queryJournal(service?: string, lines: number = 50): Promise<string> {
    const cmd = ["journalctl", "--no-pager", "-n", lines.toString()];
    if (service) {
        cmd.push("-u", service);
    }

    try {
        return await cockpit.spawn(cmd);
    } catch (e: unknown) {
        return `Error querying journal: ${e instanceof Error ? e.message : String(e)}`;
    }
}
