/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { isSensitivePath } from "../../tool-policy.js";
import { execute } from "./exec.js";

const MAX_READ_SIZE = 100 * 1024; // 100KB

/**
 * Low-risk reads are approved from the requested path alone, so refuse a
 * path that only reaches a sensitive file through a symlink. The model can
 * retry with the real path, which then goes through approval.
 */
async function symlinkTargetError(path: string): Promise<string | null> {
    const home = cockpit.info.user.home;
    const resolved = await execute(["realpath", "-m", "--", path]);
    const target = resolved.output.trim();
    if (resolved.exitCode !== 0 || !target)
        return `Error: could not resolve ${path}`;
    if (isSensitivePath(target, home) && !isSensitivePath(path, home))
        return `Error: ${path} resolves to ${target}, which requires explicit user approval. Request that path directly.`;
    return null;
}

export async function readFile(path: string): Promise<string> {
    const refusal = await symlinkTargetError(path);
    if (refusal)
        return refusal;
    try {
        const handle = cockpit.file(path, { max_read_size: MAX_READ_SIZE });
        const content = await handle.read();
        handle.close();
        return content ?? `Error reading file: ${path} does not exist`;
    } catch (e: unknown) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
    }
}

const SYSTEM_BACKUP_DIR = "/var/lib/cockpit-copilot-agent/backups";
const userBackupDir = () => `${cockpit.info.user.home}/.local/share/cockpit/copilot-backups`;

const timestamp = (date: Date): string =>
    date.toISOString().replace(/[-:]/g, "")
            .replace(/\..*$/, "")
            .replace("T", "-");

/**
 * Copy an existing file into a backup tree that mirrors its absolute path.
 *
 * Backups live outside the file's own directory on purpose: a copy next to
 * the original (e.g. in /etc/sudoers.d or a conf.d directory) could be
 * picked up by the service that reads that directory.
 */
async function backupFile(path: string, superuser: boolean): Promise<string | null> {
    const base = superuser ? SYSTEM_BACKUP_DIR : userBackupDir();
    const target = `${base}/${timestamp(new Date())}${path}`;
    const options = superuser ? { superuser: "require" as const } : {};
    const directory = target.slice(0, target.lastIndexOf("/"));
    const steps = [
        ["mkdir", "-p", "--", directory],
        ["chmod", "700", "--", base],
        // -p keeps mode, ownership and timestamps so a restore is exact.
        ["cp", "-p", "--", path, target],
    ];
    for (const argv of steps) {
        const result = await execute(argv, options);
        if (result.exitCode !== 0 || result.problem !== undefined)
            return null;
    }
    return target;
}

export interface WriteOptions {
    backup?: boolean;
}

export async function writeFile(path: string, content: string, options: WriteOptions = {}): Promise<string> {
    if (!path.startsWith("/"))
        return `Error writing file: ${path} is not an absolute path`;
    // The backup target is derived by appending the path to the backup
    // directory, where "." and ".." would resolve differently than for the
    // write itself (and could point a privileged copy at an unrelated file).
    if (path.split("/").some(segment => segment === "." || segment === ".."))
        return `Error writing file: ${path} contains "." or ".." segments; use a normalized absolute path`;

    const exists = (await execute(["test", "-e", path], { superuser: "try" })).exitCode === 0;
    // Files the user cannot write themselves (typically under /etc) are
    // written as root when the session has administrative access.
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const writable = (await execute(["test", "-w", exists ? path : parent])).exitCode === 0;
    const superuser = !writable;

    let backup: string | null = null;
    if (exists && options.backup !== false) {
        backup = await backupFile(path, superuser);
        if (!backup)
            return `Error writing file: could not back up ${path}; nothing was changed. Retry with backup=false to skip the backup.`;
    }

    const handle = cockpit.file(path, superuser ? { superuser: "require" } : {});
    try {
        await handle.replace(content);
    } catch (e: unknown) {
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        handle.close();
    }

    // Replacing a file creates a new inode; restore the original mode and
    // ownership from the backup copy.
    if (backup) {
        const reference = superuser ? { superuser: "require" as const } : {};
        await execute(["chmod", `--reference=${backup}`, "--", path], reference);
        if (superuser)
            await execute(["chown", `--reference=${backup}`, "--", path], reference);
    }

    const lines = [`Successfully wrote ${content.length} characters to ${path}${superuser ? " (as root)" : ""}.`];
    if (backup)
        lines.push(`Previous version backed up to ${backup}. To roll back, read that file and write it back.`);
    else if (!exists)
        lines.push("The file did not exist before; delete it to roll back.");
    return lines.join("\n");
}

/** Current content for previewing a write; null if the file does not exist. */
export async function readForPreview(path: string): Promise<string | null> {
    const handle = cockpit.file(path, { superuser: "try", max_read_size: MAX_READ_SIZE });
    try {
        return await handle.read();
    } finally {
        handle.close();
    }
}

export async function listDir(path: string): Promise<string[]> {
    const refusal = await symlinkTargetError(path);
    if (refusal)
        return [refusal];
    // Use ls -F to get similar output to the Python implementation
    const result = await cockpit.spawn(["ls", "-a1F", "--", path]);
    return result.split("\n").filter(line => line !== "." && line !== ".." && line !== "");
}
