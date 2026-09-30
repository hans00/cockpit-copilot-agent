/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { execute, run } from "./exec.js";

const available = (result: { exitCode: number; problem?: string }): boolean =>
    result.problem === undefined && result.exitCode !== 127;

export async function getSecurityStatus(): Promise<string> {
    const [selinux, apparmor, sshFailures, pendingSecurity] = await Promise.all([
        execute(["getenforce"]),
        execute(["aa-status", "--enabled"], { superuser: "try" }),
        // Covers both the "sshd" (Fedora/Arch) and "ssh" (Debian) unit names.
        execute(["journalctl", "--no-pager", "-q", "-o", "cat", "--since", "-24h",
            "-u", "sshd", "-u", "ssh",
            "--grep", "Failed password|Invalid user|authentication failure"]),
        execute(["sh", "-c", "command -v dnf >/dev/null && dnf -q updateinfo list --security 2>/dev/null | head -n 40"]),
    ]);

    const lines: string[] = [];
    lines.push(`SELinux: ${available(selinux) ? selinux.output.trim() || "unknown" : "not installed"}`);
    lines.push(`AppArmor: ${available(apparmor)
        ? (apparmor.exitCode === 0 ? "enabled" : "disabled")
        : "not installed"}`);

    const failures = sshFailures.exitCode === 0
        ? sshFailures.output.split("\n").filter(line => line.trim())
        : [];
    const sources = new Map<string, number>();
    for (const line of failures) {
        const match = line.match(/from\s+([0-9a-fA-F.:]+)/);
        if (match)
            sources.set(match[1], (sources.get(match[1]) || 0) + 1);
    }
    const topSources = [...sources.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([address, count]) => `  ${address}: ${count}`);
    lines.push(`Failed SSH authentication attempts (24h): ${failures.length}`);
    if (topSources.length)
        lines.push(`Top sources:\n${topSources.join("\n")}`);

    if (pendingSecurity.exitCode === 0 && pendingSecurity.output.trim())
        lines.push(`Pending security advisories (dnf):\n${pendingSecurity.output.trimEnd()}`);

    return lines.join("\n");
}

const TARGET_PATTERN = /^[A-Za-z0-9._-]+(:\d{1,5})?$/;

/**
 * Show the subject, issuer and expiry of a certificate, either from a PEM
 * file on this host or from a TLS endpoint ("host:port").
 */
export async function checkCertificate(target: string): Promise<string> {
    const fields = ["-noout", "-subject", "-issuer", "-enddate", "-ext", "subjectAltName"];
    let certificate: string;
    if (target.startsWith("/")) {
        certificate = await run(["openssl", "x509", "-in", target, ...fields], { superuser: "try" });
    } else {
        if (!TARGET_PATTERN.test(target))
            return `Error: invalid target ${JSON.stringify(target)}; use an absolute path or host:port`;
        const [host, port = "443"] = target.split(":");
        certificate = await run(["sh", "-c",
            'echo | timeout 10 openssl s_client -connect "$0:$1" -servername "$0" 2>/dev/null | openssl x509 ' + fields.join(" "),
            host, port]);
    }

    const expiry = certificate.match(/notAfter=(.+)/)?.[1];
    if (expiry) {
        const days = Math.floor((Date.parse(expiry) - Date.now()) / 86400000);
        if (Number.isFinite(days))
            certificate += `\n\n${days < 0 ? `EXPIRED ${-days} days ago` : `Expires in ${days} days`}`;
    }
    return certificate;
}

export async function listScheduledJobs(): Promise<string> {
    const [userCrontab, systemCron] = await Promise.all([
        execute(["crontab", "-l"]),
        run(["sh", "-c", "cat /etc/crontab 2>/dev/null; for f in /etc/cron.d/*; do [ -f \"$f\" ] && printf '\\n# %s\\n' \"$f\" && cat \"$f\"; done"],
            { superuser: "try" }),
    ]);
    const crontab = userCrontab.exitCode === 0 ? userCrontab.output.trimEnd() || "(empty)" : "(no crontab for current user)";
    return `Current user's crontab:\n${crontab}\n\nSystem cron:\n${systemCron}`;
}
