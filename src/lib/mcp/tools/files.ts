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
        return content;
    } catch (e: unknown) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function writeFile(path: string, content: string): Promise<string> {
    try {
        const handle = cockpit.file(path);
        await handle.replace(content);
        handle.close();
        return `Successfully wrote to ${path}`;
    } catch (e: unknown) {
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
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
