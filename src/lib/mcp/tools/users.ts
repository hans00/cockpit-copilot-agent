/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { execute, formatResult, run } from "./exec.js";

// POSIX-portable user and group names, which also rules out option-looking
// values such as "-o".
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*\$?$/;

const invalidName = (kind: string, name: string): string | null =>
    NAME_PATTERN.test(name) && name.length <= 32 ? null : `Error: invalid ${kind} name ${JSON.stringify(name)}`;

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
    const invalid = invalidName("user", username);
    if (invalid)
        return invalid;
    try {
        await cockpit.spawn(["useradd", "-m", username], { superuser: "require" });
        return `User ${username} added successfully.`;
    } catch (e: unknown) {
        return `Error adding user: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function getUserInfo(username: string): Promise<string> {
    const invalid = invalidName("user", username);
    if (invalid)
        return invalid;
    const [passwd, id, status, lastLogin, sudo] = await Promise.all([
        run(["getent", "passwd", username]),
        run(["id", username]),
        // Password/lock status needs root; "L" in the second field means locked.
        run(["passwd", "-S", username], { superuser: "try" }),
        run(["lastlog", "-u", username]).then(output =>
            output.includes("[failed to run") ? run(["last", "-n", "5", username]) : output),
        run(["sudo", "-l", "-U", username], { superuser: "try" }),
    ]);
    return [
        `Account: ${passwd}`,
        `Identity: ${id}`,
        `Password status: ${status}`,
        `Last login:\n${lastLogin}`,
        `Sudo privileges:\n${sudo}`,
    ].join("\n\n");
}

export async function getLoginHistory(limit: number): Promise<string> {
    const bounded = String(Math.min(Math.max(Math.trunc(limit) || 20, 1), 200));
    const [recent, failed] = await Promise.all([
        run(["last", "-n", bounded, "-w"]),
        // lastb reads /var/log/btmp, which only root can read.
        execute(["lastb", "-n", bounded, "-w"], { superuser: "try" }),
    ]);
    return `Recent logins:\n${recent}\n\nFailed logins:\n${formatResult(failed)}`;
}

export type UserModification = "lock" | "unlock" | "add_group" | "remove_group";

export async function modifyUser(username: string, action: UserModification, group?: string): Promise<string> {
    const invalid = invalidName("user", username);
    if (invalid)
        return invalid;

    let argv: string[];
    if (action === "lock") {
        argv = ["usermod", "-L", username];
    } else if (action === "unlock") {
        argv = ["usermod", "-U", username];
    } else {
        if (!group)
            return "Error: group is required for add_group and remove_group";
        const invalidGroup = invalidName("group", group);
        if (invalidGroup)
            return invalidGroup;
        argv = action === "add_group"
            ? ["usermod", "-aG", group, username]
            : ["gpasswd", "-d", username, group];
    }

    const result = await execute(argv, { superuser: "require" });
    if (result.exitCode !== 0 || result.problem !== undefined)
        return `Error: ${formatResult(result)}`;
    return `${action} succeeded for ${username}${group ? ` (${group})` : ""}.\n${await run(["id", username])}`;
}
