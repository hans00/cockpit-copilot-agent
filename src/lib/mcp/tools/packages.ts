/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { CommandResult, execute, formatResult } from "./exec.js";

interface PackageManagerCommands {
    name: string;
    install: string[];
    remove: string[];
    search: string[];
    // Refresh metadata before listing updates; may need root.
    refresh?: string[];
    updates: string[];
    // Exit codes (besides 0) that mean "updates are available".
    updatesExitCodes?: number[];
    history?: string[];
    environ?: string[];
}

const PACKAGE_MANAGERS: PackageManagerCommands[] = [
    {
        name: "dnf",
        install: ["dnf", "install", "-y"],
        remove: ["dnf", "remove", "-y"],
        search: ["dnf", "search"],
        updates: ["dnf", "check-update", "-q"],
        updatesExitCodes: [100],
        history: ["dnf", "history", "list"],
    },
    {
        name: "apt-get",
        install: ["apt-get", "install", "-y"],
        remove: ["apt-get", "remove", "-y"],
        search: ["apt-cache", "search"],
        refresh: ["apt-get", "update", "-q"],
        updates: ["apt", "list", "--upgradable"],
        history: ["sh", "-c", "tail -n 60 /var/log/apt/history.log"],
        // Never block on debconf prompts; there is no terminal to answer them.
        environ: ["DEBIAN_FRONTEND=noninteractive"],
    },
    {
        name: "zypper",
        install: ["zypper", "--non-interactive", "install"],
        remove: ["zypper", "--non-interactive", "remove"],
        search: ["zypper", "search"],
        updates: ["zypper", "--non-interactive", "list-updates"],
        history: ["sh", "-c", "tail -n 60 /var/log/zypp/history"],
    },
    {
        name: "pacman",
        install: ["pacman", "-S", "--noconfirm", "--needed"],
        remove: ["pacman", "-R", "--noconfirm"],
        search: ["pacman", "-Ss"],
        // checkupdates (pacman-contrib) syncs into a temporary database;
        // pacman -Qu alone only reflects the last sync.
        updates: ["sh", "-c", "if command -v checkupdates >/dev/null; then checkupdates; else pacman -Qu; fi"],
        // checkupdates exits 2 when there are no updates
        updatesExitCodes: [2],
        history: ["sh", "-c", "grep -E '\\[ALPM\\] (installed|removed|upgraded)' /var/log/pacman.log | tail -n 60"],
    },
];

let detected: Promise<PackageManagerCommands> | null = null;

async function getPackageManager(): Promise<PackageManagerCommands> {
    if (!detected) {
        detected = (async () => {
            for (const pm of PACKAGE_MANAGERS) {
                const found = await execute(["sh", "-c", 'command -v "$0"', pm.name]);
                if (found.exitCode === 0)
                    return pm;
            }
            throw new Error("No supported package manager found (dnf, apt-get, zypper, pacman).");
        })();
        detected.catch(() => {
            detected = null;
        });
    }
    return detected;
}

const options = (pm: PackageManagerCommands, superuser: boolean) => ({
    ...(superuser ? { superuser: "require" as const } : {}),
    ...(pm.environ ? { environ: pm.environ } : {}),
});

// Package managers disagree on "--" support, so reject option-looking
// arguments instead of relying on it.
const optionLike = (values: string[]): string | undefined =>
    values.find(value => value.startsWith("-") || value.trim() === "");

const describe = (action: string, result: CommandResult): string =>
    result.exitCode === 0 && result.problem === undefined
        ? formatResult(result)
        : `Error ${action}:\n${formatResult(result)}`;

export async function search(query: string): Promise<string> {
    try {
        if (optionLike([query]) !== undefined)
            return `Error: invalid search query ${JSON.stringify(query)}`;
        const pm = await getPackageManager();
        return describe("searching packages", await execute([...pm.search, query], options(pm, false)));
    } catch (e: unknown) {
        return `Error searching packages: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function install(packages: string[]): Promise<string> {
    try {
        const invalid = optionLike(packages);
        if (packages.length === 0 || invalid !== undefined)
            return `Error: invalid package name ${JSON.stringify(invalid ?? "")}`;
        const pm = await getPackageManager();
        return describe("installing packages", await execute([...pm.install, ...packages], options(pm, true)));
    } catch (e: unknown) {
        return `Error installing packages: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function remove(packages: string[]): Promise<string> {
    try {
        const invalid = optionLike(packages);
        if (packages.length === 0 || invalid !== undefined)
            return `Error: invalid package name ${JSON.stringify(invalid ?? "")}`;
        const pm = await getPackageManager();
        return describe("removing packages", await execute([...pm.remove, ...packages], options(pm, true)));
    } catch (e: unknown) {
        return `Error removing packages: ${e instanceof Error ? e.message : String(e)}`;
    }
}

const readIfExists = async (path: string): Promise<string | null> => {
    const file = cockpit.file(path);
    try {
        return await file.read();
    } catch {
        return null;
    } finally {
        file.close();
    }
};

/** Report whether a reboot (or service restarts) is needed after updates. */
export async function rebootStatus(): Promise<string> {
    const debianFlag = await readIfExists("/var/run/reboot-required");
    if (debianFlag !== null) {
        const pkgs = await readIfExists("/var/run/reboot-required.pkgs");
        return `Reboot required.${pkgs ? `\nTriggered by:\n${pkgs.trim()}` : ""}`;
    }

    const needsRestarting = await execute(["needs-restarting", "-r"], { superuser: "try" });
    if (needsRestarting.problem === undefined && needsRestarting.exitCode !== 127) {
        if (needsRestarting.exitCode === 1)
            return `Reboot required.\n${needsRestarting.output.trim()}`;
        if (needsRestarting.exitCode === 0)
            return `No reboot required.\n${needsRestarting.output.trim()}`;
    }

    // Fallback: compare the running kernel with the newest installed one.
    const running = (await execute(["uname", "-r"])).output.trim();
    const installed = await execute(["sh", "-c", "ls -1 /lib/modules 2>/dev/null | sort -V | tail -n 1"]);
    const newest = installed.output.trim();
    if (running && newest && running !== newest)
        return `Reboot likely required: running kernel ${running}, newest installed ${newest}.`;
    return `No reboot indicator found (running kernel ${running || "unknown"}).`;
}

export async function listUpdates(refresh: boolean): Promise<string> {
    try {
        const pm = await getPackageManager();
        const sections: string[] = [];
        if (refresh && pm.refresh) {
            const refreshed = await execute(pm.refresh, options(pm, true));
            if (refreshed.exitCode !== 0 || refreshed.problem !== undefined)
                sections.push(`Warning: metadata refresh failed:\n${formatResult(refreshed)}`);
        }
        const result = await execute(pm.updates, options(pm, false));
        const ok = result.problem === undefined &&
            (result.exitCode === 0 || (pm.updatesExitCodes || []).includes(result.exitCode));
        // Drop apt's "Listing..." header and its unstable-CLI warning on stderr.
        const lines = result.output.split("\n")
                .filter(line => line.trim() && !line.startsWith("Listing...") && !line.startsWith("WARNING:"));
        sections.push(ok
            ? (lines.length ? `Available updates (${pm.name}, ${lines.length}):\n${lines.join("\n")}` : `No updates available (${pm.name}).`)
            : `Error listing updates:\n${formatResult(result)}`);
        sections.push(await rebootStatus());
        return sections.join("\n\n");
    } catch (e: unknown) {
        return `Error listing updates: ${e instanceof Error ? e.message : String(e)}`;
    }
}

export async function history(): Promise<string> {
    try {
        const pm = await getPackageManager();
        if (!pm.history)
            return `Package history is not supported for ${pm.name}.`;
        return describe("reading package history", await execute(pm.history, { superuser: "try" }));
    } catch (e: unknown) {
        return `Error reading package history: ${e instanceof Error ? e.message : String(e)}`;
    }
}
