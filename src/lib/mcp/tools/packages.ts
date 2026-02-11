/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

const PACKAGE_MANAGERS: Record<string, any> = {
    "dnf": {
        "install": ["dnf", "install", "-y"],
        "remove": ["dnf", "remove", "-y"],
        "search": ["dnf", "search"]
    },
    "apt-get": {
        "install": ["apt-get", "install", "-y"],
        "remove": ["apt-get", "remove", "-y"],
        "search": ["apt-cache", "search"]
    },
    "zypper": {
        "install": ["zypper", "install", "-y"],
        "remove": ["zypper", "remove", "-y"],
        "search": ["zypper", "search"]
    },
};

async function getPackageManager(): Promise<any> {
    for (const pm in PACKAGE_MANAGERS) {
        try {
            await cockpit.spawn(["which", pm]);
            return PACKAGE_MANAGERS[pm];
        } catch (e) {
            // Keep looking
        }
    }
    throw new Error("No supported package manager found (dnf, apt-get, zypper).");
}

export async function search(query: string): Promise<string> {
    try {
        const cmds = await getPackageManager();
        const result = await cockpit.spawn([...cmds.search, query]);
        return result;
    } catch (e: any) {
        return `Error searching packages: ${e.message || e}`;
    }
}

export async function install(packages: string[]): Promise<string> {
    try {
        const cmds = await getPackageManager();
        const result = await cockpit.spawn([...cmds.install, ...packages], { superuser: "require" });
        return result;
    } catch (e: any) {
        return `Error installing packages: ${e.message || e}`;
    }
}

export async function remove(packages: string[]): Promise<string> {
    try {
        const cmds = await getPackageManager();
        const result = await cockpit.spawn([...cmds.remove, ...packages], { superuser: "require" });
        return result;
    } catch (e: any) {
        return `Error removing packages: ${e.message || e}`;
    }
}
