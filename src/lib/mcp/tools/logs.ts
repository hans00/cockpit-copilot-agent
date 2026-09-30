/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { run } from "./exec.js";

export const MAX_JOURNAL_LINES = 1000;

export const JOURNAL_PRIORITIES = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"] as const;

export interface JournalQuery {
    service?: string | undefined;
    lines?: number | undefined;
    priority?: typeof JOURNAL_PRIORITIES[number] | undefined;
    since?: string | undefined;
    until?: string | undefined;
    grep?: string | undefined;
    boot?: number | undefined;
    kernel?: boolean | undefined;
}

export function buildJournalCommand(query: JournalQuery): string[] {
    const bounded = Math.min(Math.max(Math.trunc(query.lines ?? 50) || 50, 1), MAX_JOURNAL_LINES);
    const cmd = ["journalctl", "--no-pager", "-n", bounded.toString()];
    if (query.service)
        cmd.push("-u", query.service);
    if (query.priority)
        cmd.push("-p", query.priority);
    if (query.since)
        cmd.push("--since", query.since);
    if (query.until)
        cmd.push("--until", query.until);
    if (query.grep)
        cmd.push("--grep", query.grep, "--case-sensitive=false");
    if (query.boot !== undefined)
        cmd.push("-b", String(Math.trunc(query.boot)));
    if (query.kernel)
        cmd.push("-k");
    return cmd;
}

export async function queryJournal(query: JournalQuery = {}): Promise<string> {
    return await run(buildJournalCommand(query));
}

export async function listBoots(): Promise<string> {
    return await run(["journalctl", "--list-boots", "--no-pager"]);
}
