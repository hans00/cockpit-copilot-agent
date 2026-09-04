/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";

interface PackageManagerCommands {
    install: string[];
    remove: string[];
    search: string[];
}

const PACKAGE_MANAGERS: Record<string, PackageManagerCommands> = {
    dnf: {
        install: ["dnf", "install", "-y"],
        remove: ["dnf", "remove", "-y"],
        search: ["dnf", "search"]
    },
    "apt-get": {
        install: ["apt-get", "install", "-y"],
        remove: ["apt-get", "remove", "-y"],
        search: ["apt-cache", "search"]
    },
    zypper: {
        install: ["zypper", "install", "-y"],
        remove: ["zypper", "remove", "-y"],
        search: ["zypper", "search"]
    },
};

async function getPackageManager(): Promise<PackageManagerCommands> {
    for (const pm in PACKAGE_MANAGERS) {
        try {
            await cockpit.spawn(["which", pm]);
            return PACKAGE_MANAGERS[pm];
        } catch {
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
    } catch (e: unknown) {
        return `Error searching packages: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function install(packages: string[]): Promise<string> {
    try {
        const cmds = await getPackageManager();
        const result = await cockpit.spawn([...cmds.install, ...packages], { superuser: "require" });
        return result;
    } catch (e: unknown) {
        return `Error installing packages: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function remove(packages: string[]): Promise<string> {
    try {
        const cmds = await getPackageManager();
        const result = await cockpit.spawn([...cmds.remove, ...packages], { superuser: "require" });
        return result;
    } catch (e: unknown) {
        return `Error removing packages: ${e instanceof Error ? e.message : String(e)}`;
    }
}
