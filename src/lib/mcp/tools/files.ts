/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

const MAX_READ_SIZE = 100 * 1024; // 100KB

export async function readFile(path: string): Promise<string> {
    try {
        const handle = cockpit.file(path, { max_read_size: MAX_READ_SIZE });
        const content = await handle.read();
        handle.close();
        return content;
    } catch (e: any) {
        return `Error reading file: ${e.message || e}`;
    }
}

export async function writeFile(path: string, content: string): Promise<string> {
    try {
        const handle = cockpit.file(path);
        await handle.replace(content);
        handle.close();
        return `Successfully wrote to ${path}`;
    } catch (e: any) {
        return `Error writing file: ${e.message || e}`;
    }
}

export async function listDir(path: string): Promise<string> {
    try {
        // Use ls -F to get similar output to the Python implementation
        const result = await cockpit.spawn(["ls", "-1F", path]);
        return result;
    } catch (e: any) {
        return `Error listing directory: ${e.message || e}`;
    }
}
