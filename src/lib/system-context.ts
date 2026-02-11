/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

export async function getSystemContext(): Promise<string> {
    try {
        const hostname = await cockpit.spawn(["hostname"]).then(data => data.trim());
        const osRelease = await cockpit.file("/etc/os-release").read();

        let prettyName = "Linux";
        if (osRelease) {
            const match = osRelease.match(/PRETTY_NAME="([^"]+)"/);
            if (match) prettyName = match[1];
        }

        const uptime = await cockpit.spawn(["uptime", "-p"]).then(data => data.trim());

        return `Hostname: ${hostname}
OS: ${prettyName}
Uptime: ${uptime}
Running in Cockpit Web Console.
`;
    } catch (e) {
        console.error("Error gathering system context:", e);
        return "System context unavailable.";
    }
}
