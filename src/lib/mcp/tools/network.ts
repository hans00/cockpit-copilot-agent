/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { execute, formatResult, run } from "./exec.js";

export async function getInfo(): Promise<string> {
    return await run(["ip", "-brief", "address"]);
}

export async function downloadFile(url: string, dest: string): Promise<string> {
    let cmd: string[];

    try {
        await cockpit.spawn(["which", "curl"]);
        // -f: treat HTTP errors (404, 500...) as failures instead of saving the error page
        cmd = ["curl", "-fsSL", "-o", dest, url];
    } catch {
        try {
            await cockpit.spawn(["which", "wget"]);
            cmd = ["wget", "-O", dest, url];
        } catch {
            return "Error: neither curl nor wget found.";
        }
    }

    const result = await execute(cmd);
    if (result.exitCode === 0 && result.problem === undefined)
        return `Successfully downloaded ${url} to ${dest}`;
    return `Error downloading file:\n${formatResult(result)}`;
}

export async function listListeningPorts(): Promise<string> {
    // Process names for other users' sockets are only visible to root.
    return await run(["ss", "-tulpnH"], { superuser: "try" });
}

export async function getRoutesAndDns(): Promise<string> {
    const [routes, routes6, dns] = await Promise.all([
        run(["ip", "route", "show"]),
        run(["ip", "-6", "route", "show"]),
        execute(["resolvectl", "status", "--no-pager"]),
    ]);
    let resolver = dns.exitCode === 0 && dns.problem === undefined ? dns.output.trimEnd() : "";
    if (!resolver) {
        const file = cockpit.file("/etc/resolv.conf");
        try {
            resolver = (await file.read()) || "(empty /etc/resolv.conf)";
        } catch {
            resolver = "(unable to read /etc/resolv.conf)";
        } finally {
            file.close();
        }
    }
    return `IPv4 routes:\n${routes}\n\nIPv6 routes:\n${routes6}\n\nDNS:\n${resolver}`;
}

// Hostnames, IPv4 and IPv6 addresses only; never an option-looking value.
const HOST_PATTERN = /^[A-Za-z0-9._:-]+$/;

export async function checkConnectivity(host: string, port?: number): Promise<string> {
    if (!HOST_PATTERN.test(host) || host.startsWith("-"))
        return `Error: invalid host ${JSON.stringify(host)}`;

    const [resolved, ping] = await Promise.all([
        run(["getent", "ahosts", host]),
        run(["ping", "-c", "3", "-W", "2", "--", host]),
    ]);
    const sections = [`Resolution:\n${resolved}`, `Ping:\n${ping}`];
    if (port !== undefined) {
        // Use the shell's /dev/tcp when bash exists, else fall back to nc.
        const tcp = await execute(["timeout", "5", "bash", "-c", 'exec 3<>"/dev/tcp/$0/$1"', host, String(port)]);
        const reachable = tcp.exitCode === 0
            ? `TCP ${host}:${port} is reachable`
            : tcp.problem === undefined && tcp.exitCode !== 127
                ? `TCP ${host}:${port} is NOT reachable (${tcp.exitCode === 124 ? "timed out" : formatResult(tcp)})`
                : await run(["nc", "-z", "-w", "5", host, String(port)]);
        sections.push(`Port check:\n${reachable}`);
    }
    return sections.join("\n\n");
}

export async function getFirewallStatus(): Promise<string> {
    const firewalld = await execute(["firewall-cmd", "--state"], { superuser: "try" });
    if (firewalld.exitCode === 0 && firewalld.output.trim() === "running")
        return `firewalld is running\n\n${await run(["firewall-cmd", "--list-all-zones"], { superuser: "try" })}`;

    const ufw = await execute(["ufw", "status", "verbose"], { superuser: "try" });
    if (ufw.exitCode === 0 && ufw.problem === undefined)
        return `ufw:\n${ufw.output.trimEnd()}`;

    const nft = await execute(["nft", "list", "ruleset"], { superuser: "try" });
    if (nft.exitCode === 0 && nft.problem === undefined)
        return `nftables ruleset:\n${nft.output.trimEnd() || "(empty ruleset)"}`;

    return `${await run(["iptables", "-S"], { superuser: "try" })}\n(no firewalld, ufw or nft detected; showing iptables)`;
}
