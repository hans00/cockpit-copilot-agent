/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { ToolRegistration } from "./types.js";

// Built-in low-risk tools that take a filesystem path. A low-risk tool still
// requires approval when it is pointed at a path that commonly holds secrets.
const PATH_ARGUMENTS: Record<string, string> = {
    file_read: "path",
    file_list: "path",
};

const SENSITIVE_EXACT = new Set([
    "/etc/shadow",
    "/etc/shadow-",
    "/etc/gshadow",
    "/etc/gshadow-",
    "/etc/sudoers",
    "/etc/cockpit/copilot.credentials.json",
    "/root",
]);

const SENSITIVE_PREFIXES = [
    "/root/",
    "/etc/sudoers.d/",
    "/etc/ssl/private/",
    "/etc/pki/tls/private/",
    "/dev/",
];

const SENSITIVE_SEGMENTS = new Set([
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".password-store",
]);

const SENSITIVE_BASENAMES = [
    /^\.env(\..*)?$/,
    /^\.netrc$/,
    /^\.pgpass$/,
    /^\.git-credentials$/,
    /^\.my\.cnf$/,
    /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/,
    /^ssh_host_.*_key$/,
    /\.(pem|key|p12|pfx|jks|kdbx)$/,
    /credentials(\.json)?$/,
];

/**
 * Lexically normalize an absolute path: expand a leading "~", collapse
 * duplicate separators and resolve "." and ".." segments. Symlinks are not
 * resolved here; callers that open the file resolve them separately.
 * Returns null for relative paths.
 */
export function normalizePath(path: string, home: string): string | null {
    let expanded = path.trim();
    if (expanded === "~" || expanded.startsWith("~/"))
        expanded = home + expanded.slice(1);
    if (!expanded.startsWith("/"))
        return null;

    const segments: string[] = [];
    for (const segment of expanded.split("/")) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..")
            segments.pop();
        else
            segments.push(segment);
    }
    return "/" + segments.join("/");
}

export function isSensitivePath(path: string, home: string): boolean {
    const normalized = normalizePath(path, home);
    if (normalized === null)
        return true;
    if (SENSITIVE_EXACT.has(normalized))
        return true;
    if (SENSITIVE_PREFIXES.some(prefix => normalized.startsWith(prefix)))
        return true;
    // Per-process secrets are also reachable through each thread's entry
    // (/proc/<pid>/task/<tid>/...) and via /proc/self or /proc/thread-self.
    if (/^\/proc\/[^/]+(\/task\/[^/]+)?\/(environ|mem|maps|smaps|cmdline|auxv)$/.test(normalized))
        return true;

    const segments = normalized.split("/").filter(Boolean);
    if (segments.some(segment => SENSITIVE_SEGMENTS.has(segment)))
        return true;
    const basename = segments[segments.length - 1] || "";
    return SENSITIVE_BASENAMES.some(pattern => pattern.test(basename));
}

// Approvals for these can never be remembered for a whole chat.
const ALWAYS_ASK = new Set(["shell", "sudo_shell"]);

/**
 * Whether "allow for this chat" may be offered for a call that needs
 * approval. Calls that only need approval because they touch a sensitive
 * path, and arbitrary shell commands, are always asked for individually.
 */
export function canRememberApproval(reference: ToolRegistration | undefined): boolean {
    if (!reference)
        return false;
    if (!reference.builtin)
        return true;
    return reference.tool._meta?.isLowRisk !== true && !ALWAYS_ASK.has(reference.originalName);
}

/**
 * Decide whether a tool call needs explicit user approval.
 *
 * Risk metadata is only honoured for built-in tools; external MCP servers
 * cannot exempt their own tools from approval.
 */
export function requiresApproval(
    reference: ToolRegistration | undefined,
    args: Record<string, unknown>,
    home: string
): boolean {
    // Unknown tools are never executed, so there is nothing to approve.
    if (!reference)
        return false;
    if (!reference.builtin || reference.tool._meta?.isLowRisk !== true)
        return true;

    const pathArgument = PATH_ARGUMENTS[reference.originalName];
    if (pathArgument !== undefined) {
        const value = args[pathArgument];
        return typeof value !== "string" || isSensitivePath(value, home);
    }
    return false;
}
