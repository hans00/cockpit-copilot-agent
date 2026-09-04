/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export async function listUsers(): Promise<string[]> {
    const output = await cockpit.spawn(["getent", "passwd"]);
    const users: string[] = [];
    for (const line of output.split("\n")) {
        const parts = line.split(":");
        if (parts.length < 3) continue;
        const uid = parseInt(parts[2]);
        if (uid >= 1000 && uid < 65534) {
            users.push(parts[0]);
        }
    }
    return users;
}

export async function addUser(username: string): Promise<string> {
    try {
        await cockpit.spawn(["useradd", "-m", username], { superuser: "require" });
        return `User ${username} added successfully.`;
    } catch (e: unknown) {
        return `Error adding user: ${e instanceof Error ? e.message : String(e)}`;
    }
}
