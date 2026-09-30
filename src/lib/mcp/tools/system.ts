/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { execute, formatResult, run } from "./exec.js";

const readText = async (path: string): Promise<string> => {
    const file = cockpit.file(path);
    try {
        return (await file.read()) || "";
    } catch {
        return "";
    } finally {
        file.close();
    }
};

const firstLine = async (argv: string[]): Promise<string> => {
    const result = await execute(argv);
    return result.exitCode === 0 ? result.output.trim().split("\n")[0] : "";
};

export async function getSystemInfo(): Promise<string> {
    const [hostname, osRelease, kernel, arch, uptime, virt, bootTime] = await Promise.all([
        firstLine(["hostname"]),
        readText("/etc/os-release"),
        firstLine(["uname", "-r"]),
        firstLine(["uname", "-m"]),
        firstLine(["uptime", "-p"]),
        // Prints "none" and exits 1 on bare metal
        execute(["systemd-detect-virt"]).then(result => result.output.trim()),
        firstLine(["uptime", "-s"]),
    ]);
    const prettyName = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1] || "unknown";
    return [
        `Hostname: ${hostname || "unknown"}`,
        `OS: ${prettyName}`,
        `Kernel: ${kernel || "unknown"} (${arch || "unknown"})`,
        `Virtualization: ${virt || "unknown"}`,
        `Booted: ${bootTime || "unknown"}`,
        `Uptime: ${uptime || "unknown"}`,
    ].join("\n");
}

const MEMINFO_FIELDS = ["MemTotal", "MemAvailable", "SwapTotal", "SwapFree"];

export function parseMeminfo(meminfo: string): Record<string, number> {
    const values: Record<string, number> = {};
    for (const line of meminfo.split("\n")) {
        const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
        if (match && MEMINFO_FIELDS.includes(match[1]))
            values[match[1]] = Number(match[2]) * 1024;
    }
    return values;
}

const formatBytes = (bytes: number | undefined): string => {
    if (bytes === undefined || !Number.isFinite(bytes))
        return "unknown";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const percent = (part: number | undefined, total: number | undefined): string =>
    part !== undefined && total ? `${((part / total) * 100).toFixed(1)}%` : "n/a";

export async function getResources(): Promise<string> {
    const [loadavg, meminfo, cpus, pressure] = await Promise.all([
        readText("/proc/loadavg"),
        readText("/proc/meminfo"),
        firstLine(["nproc"]),
        readText("/proc/pressure/cpu"),
    ]);
    const memory = parseMeminfo(meminfo);
    const used = memory.MemTotal !== undefined && memory.MemAvailable !== undefined
        ? memory.MemTotal - memory.MemAvailable
        : undefined;
    const swapUsed = memory.SwapTotal !== undefined && memory.SwapFree !== undefined
        ? memory.SwapTotal - memory.SwapFree
        : undefined;
    const [load1, load5, load15] = loadavg.trim().split(/\s+/);
    const lines = [
        `CPUs: ${cpus || "unknown"}`,
        `Load average (1/5/15 min): ${load1 ?? "?"} / ${load5 ?? "?"} / ${load15 ?? "?"}`,
        `Memory: ${formatBytes(used)} used of ${formatBytes(memory.MemTotal)} (${percent(used, memory.MemTotal)}), ${formatBytes(memory.MemAvailable)} available`,
        `Swap: ${formatBytes(swapUsed)} used of ${formatBytes(memory.SwapTotal)} (${percent(swapUsed, memory.SwapTotal)})`,
    ];
    const cpuPressure = pressure.split("\n").find(line => line.startsWith("some"));
    if (cpuPressure)
        lines.push(`CPU pressure: ${cpuPressure}`);
    return lines.join("\n");
}

const PSEUDO_FILESYSTEMS = ["tmpfs", "devtmpfs", "squashfs", "overlay", "efivarfs"];

export async function getDiskUsage(): Promise<string> {
    const exclude = PSEUDO_FILESYSTEMS.flatMap(type => ["-x", type]);
    const [space, inodes] = await Promise.all([
        run(["df", "-hT", ...exclude]),
        run(["df", "-i", ...exclude]),
    ]);
    return `Space:\n${space}\n\nInodes:\n${inodes}`;
}

export async function listTopProcesses(sortBy: "cpu" | "memory", limit: number): Promise<string> {
    const sort = sortBy === "memory" ? "-%mem" : "-%cpu";
    const result = await execute(["ps", "-eo", "pid,user,%cpu,%mem,rss,etime,stat,comm", `--sort=${sort}`]);
    if (result.exitCode !== 0 || result.problem !== undefined)
        return formatResult(result);
    const lines = result.output.trimEnd().split("\n");
    return lines.slice(0, limit + 1).join("\n");
}
