/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { run } from "./exec.js";

export const MAX_JOURNAL_LINES = 1000;

export async function queryJournal(service?: string, lines: number = 50): Promise<string> {
    const bounded = Math.min(Math.max(Math.trunc(lines) || 50, 1), MAX_JOURNAL_LINES);
    const cmd = ["journalctl", "--no-pager", "-n", bounded.toString()];
    if (service) {
        cmd.push("-u", service);
    }

    return await run(cmd);
}
