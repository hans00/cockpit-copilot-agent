/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

// Core tools
import * as systemd from "./tools/systemd.js";
import * as packages from "./tools/packages.js";
import * as disks from "./tools/disks.js";
import * as files from "./tools/files.js";
import * as network from "./tools/network.js";
import * as users from "./tools/users.js";
import * as logs from "./tools/logs.js";
import * as shell from "./tools/shell.js";
import * as system from "./tools/system.js";
import * as security from "./tools/security.js";

// Plugins
import { ToolPlugin } from "./plugins/base.js";
import { VmPlugin } from "./plugins/vm.js";
import { ContainerPlugin } from "./plugins/containers.js";
import { ZfsPlugin } from "./plugins/zfs.js";
import { SmartPlugin } from "./plugins/smart.js";

const MAX_MEMORY_ENTRIES = 100;
const MAX_MEMORY_ENTRY_LENGTH = 1000;

export type McpServerLocalOptions = {
    allow_shell_access: boolean;
};

export class McpServerLocal {
    private server: McpServer;
    private plugins: ToolPlugin[] = [];

    constructor(options: McpServerLocalOptions) {
        this.server = new McpServer(
            {
                name: "cockpit-copilot-server",
                version: "0.1.0"
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );

        this.setupTools(options);
    }

    private setupTools(options: McpServerLocalOptions) {
        if (options.allow_shell_access) {
            this.server.registerTool(
                "shell",
                {
                    title: "Shell",
                    description: "Run a shell command",
                    inputSchema: z.object({
                        command: z.string().describe("Command to run")
                    })
                },
                async ({ command }) => {
                    const result = await shell.run(command);
                    return {
                        content: [{ type: "text", text: result }]
                    };
                }
            );

            // Sudo
            this.server.registerTool(
                "sudo_shell",
                {
                    title: "Sudo Shell",
                    description: "Run a shell command with sudo",
                    inputSchema: z.object({
                        run_as: z.string().optional()
                                .describe("User to run as"),
                        command: z.string().describe("Command to run in sudo")
                    })
                },
                async ({ run_as, command }) => {
                    const result = await shell.sudo(run_as || "root", command);
                    return {
                        content: [{ type: "text", text: result }]
                    };
                }
            );
        }

        // Systemd
        this.server.registerTool(
            "service_list",
            {
                title: "List services",
                description: "List all systemd units",
                inputSchema: z.object({
                    scope: z.enum(["system", "user"]).default("system")
                            .describe("Systemd scope")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ scope }) => {
                const result = await systemd.listUnits(scope);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                };
            }
        );

        this.server.registerTool(
            "service_status",
            {
                title: "Service status",
                description: "Get status of a systemd unit",
                inputSchema: z.object({
                    unit: z.string().describe("Unit name"),
                    scope: z.enum(["system", "user"]).default("system")
                            .describe("Systemd scope")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ unit, scope }) => {
                const result = await systemd.getStatus(unit, scope);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        this.server.registerTool(
            "service_action",
            {
                title: "Manage systemd service",
                description: "Start/stop/restart/enable/disable a systemd unit",
                inputSchema: z.object({
                    unit: z.string().describe("Unit name"),
                    action: z.enum(["start", "stop", "restart", "reload", "enable", "disable"]).describe("Action to perform"),
                    scope: z.enum(["system", "user"]).default("system")
                            .describe("Systemd scope")
                })
            },
            async ({ unit, action, scope }) => {
                const result = await systemd.manageService(unit, action, scope);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        // Packages
        this.server.registerTool(
            "package_search",
            {
                title: "Search packages",
                description: "Search available packages",
                inputSchema: z.object({
                    query: z.string().describe("Search query")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ query }) => {
                const result = await packages.search(query);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                };
            }
        );

        this.server.registerTool(
            "package_install",
            {
                title: "Install packages",
                description: "Install packages (requires root)",
                inputSchema: z.object({
                    packages: z.array(z.string()).describe("List of package names")
                })
            },
            async ({ packages: pkgs }) => {
                const result = await packages.install(pkgs);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        this.server.registerTool(
            "package_remove",
            {
                title: "Remove packages",
                description: "Remove packages (requires root)",
                inputSchema: z.object({
                    packages: z.array(z.string()).describe("List of package names")
                })
            },
            async ({ packages: pkgs }) => {
                const result = await packages.remove(pkgs);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        // Disk
        this.server.registerTool(
            "disk_list",
            {
                title: "List disks",
                description: "List block devices (lsblk)",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => {
                const result = await disks.listDisks();
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        // Files
        this.server.registerTool(
            "file_read",
            {
                title: "Read file",
                description: "Read file contents",
                inputSchema: z.object({
                    path: z.string().describe("Absolute path to file")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ path }) => {
                const result = await files.readFile(path);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        this.server.registerTool(
            "file_write",
            {
                title: "Write file",
                description: "Write content to a file (requires root/permission)",
                inputSchema: z.object({
                    path: z.string().describe("Absolute path to file"),
                    content: z.string().describe("Content to write")
                })
            },
            async ({ path, content }) => {
                const result = await files.writeFile(path, content);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        this.server.registerTool(
            "file_list",
            {
                title: "List directory contents",
                description: "List directory contents",
                inputSchema: z.object({
                    path: z.string().describe("Absolute path to directory")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ path }) => {
                const result = await files.listDir(path);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                };
            }
        );

        // Network
        this.server.registerTool(
            "network_info",
            {
                title: "Network info",
                description: "Show network interfaces and IPs",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true },
            },
            async () => {
                const result = await network.getInfo();
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        this.server.registerTool(
            "file_download",
            {
                title: "Download file",
                description: "Download a file from a URL to a local path",
                inputSchema: z.object({
                    url: z.string().describe("URL to download"),
                    dest: z.string().describe("Destination path")
                })
            },
            async ({ url, dest }) => {
                const result = await network.downloadFile(url, dest);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        // Users
        this.server.registerTool(
            "user_list",
            {
                title: "List users",
                description: "List system users",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => {
                const result = await users.listUsers();
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                };
            }
        );

        this.server.registerTool(
            "user_add",
            {
                title: "Add user",
                description: "Create a new user (requires root)",
                inputSchema: z.object({
                    username: z.string().describe("Username")
                })
            },
            async ({ username }) => {
                const result = await users.addUser(username);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        this.setupDiagnosticTools();

        // User owned data
        // ~/.local/share/cockpit/copilot-memory.json
        const memoryPath = "$HOME/.local/share/cockpit/copilot-memory.json";
        this.server.registerTool(
            "memory_read",
            {
                title: "Read memory",
                description: "Read memory about user's preferences and past conversations",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => {
                try {
                    const file = cockpit.file(memoryPath.replace("$HOME", cockpit.info.user.home));
                    const result = await file.read();
                    file.close();
                    return {
                        content: [{ type: "text", text: result }]
                    };
                } catch {
                    return {
                        content: [{ type: "text", text: 'No memory found' }]
                    };
                }
            }
        );

        this.server.registerTool(
            "memory_write",
            {
                title: "Write memory",
                description: "Append memory about user's preferences and past conversations",
                inputSchema: z.object({
                    content: z.string().describe("Content to write")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ content }) => {
                // Append content to memory file, keeping only the newest
                // entries so memory_read stays small enough for the context.
                let memory: string[] = [];
                const file = cockpit.file(memoryPath.replace("$HOME", cockpit.info.user.home));
                try {
                    try {
                        const parsed: unknown = JSON.parse(await file.read());
                        if (Array.isArray(parsed))
                            memory = parsed.filter((entry): entry is string => typeof entry === "string");
                    } catch {
                        // Missing or unreadable memory starts empty
                    }
                    const entry = content.trim().slice(0, MAX_MEMORY_ENTRY_LENGTH);
                    if (!entry)
                        return { content: [{ type: "text", text: "Nothing to remember." }] };
                    const next = [...memory.filter(existing => existing !== entry), entry].slice(-MAX_MEMORY_ENTRIES);
                    await file.replace(JSON.stringify(next, null, 2));
                    return {
                        content: [{ type: "text", text: `Memory saved (${next.length}/${MAX_MEMORY_ENTRIES} entries).` }]
                    };
                } finally {
                    file.close();
                }
            }
        );
    }

    /** Read-only inspection tools plus a few scoped account changes. */
    private setupDiagnosticTools() {
        const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
        const json = (value: unknown) => typeof value === "string" ? text(value) : text(JSON.stringify(value, null, 2));
        const scope = z.enum(["system", "user"]).default("system")
                .describe("Systemd scope");

        // System
        this.server.registerTool(
            "system_info",
            {
                title: "System info",
                description: "Get hostname, OS, kernel, architecture, virtualization, boot time and uptime",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await system.getSystemInfo())
        );

        this.server.registerTool(
            "system_resources",
            {
                title: "System resources",
                description: "Get CPU count, load average, memory and swap usage",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await system.getResources())
        );

        this.server.registerTool(
            "disk_usage",
            {
                title: "Disk usage",
                description: "Get filesystem space and inode usage (df)",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await system.getDiskUsage())
        );

        this.server.registerTool(
            "process_top",
            {
                title: "Top processes",
                description: "List the processes using the most CPU or memory",
                inputSchema: z.object({
                    sort_by: z.enum(["cpu", "memory"]).default("cpu")
                            .describe("Sort key"),
                    limit: z.number().int()
                            .min(1)
                            .max(100)
                            .default(15)
                            .describe("Number of processes")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ sort_by, limit }) => text(await system.listTopProcesses(sort_by, limit))
        );

        // Services
        this.server.registerTool(
            "service_failed",
            {
                title: "Failed units",
                description: "List systemd units in the failed state",
                inputSchema: z.object({ scope }),
                _meta: { isLowRisk: true }
            },
            async ({ scope }) => json(await systemd.listFailed(scope))
        );

        this.server.registerTool(
            "service_unit_file",
            {
                title: "Show unit file",
                description: "Show a unit's definition including drop-ins (systemctl cat)",
                inputSchema: z.object({
                    unit: z.string().describe("Unit name"),
                    scope
                }),
                _meta: { isLowRisk: true }
            },
            async ({ unit, scope }) => text(await systemd.catUnit(unit, scope))
        );

        this.server.registerTool(
            "service_dependencies",
            {
                title: "Unit dependencies",
                description: "Show what a unit depends on, or with reverse=true, what depends on it (impact of stopping it)",
                inputSchema: z.object({
                    unit: z.string().describe("Unit name"),
                    reverse: z.boolean().default(false)
                            .describe("List units that depend on this unit"),
                    scope
                }),
                _meta: { isLowRisk: true }
            },
            async ({ unit, reverse, scope }) => text(await systemd.listDependencies(unit, reverse, scope))
        );

        this.server.registerTool(
            "scheduled_jobs",
            {
                title: "Scheduled jobs",
                description: "List systemd timers and cron jobs",
                inputSchema: z.object({ scope }),
                _meta: { isLowRisk: true }
            },
            async ({ scope }) => text(`Systemd timers:\n${await systemd.listTimers(scope)}\n\n${await security.listScheduledJobs()}`)
        );

        // Logs
        this.server.registerTool(
            "journal_query",
            {
                title: "Query system logs",
                description: "Query system logs (journalctl) with optional unit, priority, time range, text and boot filters",
                inputSchema: z.object({
                    service: z.string().optional()
                            .describe("Filter by systemd unit"),
                    lines: z.number().int()
                            .min(1)
                            .max(logs.MAX_JOURNAL_LINES)
                            .default(50)
                            .describe(`Number of most recent lines (max ${logs.MAX_JOURNAL_LINES})`),
                    priority: z.enum(logs.JOURNAL_PRIORITIES).optional()
                            .describe("Show this priority and more severe, e.g. 'err'"),
                    since: z.string().optional()
                            .describe("Start time, e.g. '-1h', 'today', '2024-01-31 10:00'"),
                    until: z.string().optional()
                            .describe("End time, same format as since"),
                    grep: z.string().optional()
                            .describe("Case-insensitive regular expression to match messages"),
                    boot: z.number().int()
                            .max(0)
                            .optional()
                            .describe("Boot offset: 0 is the current boot, -1 the previous one"),
                    kernel: z.boolean().optional()
                            .describe("Only kernel messages (dmesg)")
                }),
                _meta: { isLowRisk: true }
            },
            async (query) => text(await logs.queryJournal(query))
        );

        this.server.registerTool(
            "journal_boots",
            {
                title: "List boots",
                description: "List recorded boots, e.g. to find unexpected reboots",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await logs.listBoots())
        );

        // Network
        this.server.registerTool(
            "network_ports",
            {
                title: "Listening ports",
                description: "List listening TCP/UDP sockets and their processes (ss)",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await network.listListeningPorts())
        );

        this.server.registerTool(
            "network_routes",
            {
                title: "Routes and DNS",
                description: "Show IPv4/IPv6 routes and DNS resolver configuration",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await network.getRoutesAndDns())
        );

        this.server.registerTool(
            "network_check",
            {
                title: "Connectivity check",
                description: "Resolve and ping a host, optionally testing a TCP port",
                inputSchema: z.object({
                    host: z.string().describe("Hostname or IP address"),
                    port: z.number().int()
                            .min(1)
                            .max(65535)
                            .optional()
                            .describe("TCP port to test")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ host, port }) => text(await network.checkConnectivity(host, port))
        );

        this.server.registerTool(
            "firewall_status",
            {
                title: "Firewall status",
                description: "Show firewall state and rules (firewalld, ufw, nftables or iptables)",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await network.getFirewallStatus())
        );

        // Packages
        this.server.registerTool(
            "package_updates",
            {
                title: "Available updates",
                description: "List available package updates and whether a reboot is required",
                inputSchema: z.object({
                    refresh: z.boolean().default(false)
                            .describe("Refresh repository metadata first (apt; requires root)")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ refresh }) => text(await packages.listUpdates(refresh))
        );

        this.server.registerTool(
            "package_history",
            {
                title: "Package history",
                description: "Show recent package install/remove/upgrade transactions",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await packages.history())
        );

        // Users and security
        this.server.registerTool(
            "user_info",
            {
                title: "User info",
                description: "Show a user's account, groups, password/lock status, last login and sudo rights",
                inputSchema: z.object({
                    username: z.string().describe("Username")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ username }) => text(await users.getUserInfo(username))
        );

        this.server.registerTool(
            "login_history",
            {
                title: "Login history",
                description: "Show recent successful and failed logins",
                inputSchema: z.object({
                    limit: z.number().int()
                            .min(1)
                            .max(200)
                            .default(20)
                            .describe("Number of entries")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ limit }) => text(await users.getLoginHistory(limit))
        );

        this.server.registerTool(
            "user_modify",
            {
                title: "Modify user",
                description: "Lock or unlock a user account, or add/remove it from a group (requires root)",
                inputSchema: z.object({
                    username: z.string().describe("Username"),
                    action: z.enum(["lock", "unlock", "add_group", "remove_group"]).describe("Change to make"),
                    group: z.string().optional()
                            .describe("Group for add_group/remove_group")
                })
            },
            async ({ username, action, group }) => text(await users.modifyUser(username, action, group))
        );

        this.server.registerTool(
            "security_status",
            {
                title: "Security status",
                description: "Summarize SELinux/AppArmor state, failed SSH logins in the last 24h and pending security updates",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => text(await security.getSecurityStatus())
        );

        this.server.registerTool(
            "certificate_check",
            {
                title: "Certificate check",
                description: "Show subject, issuer, SANs and days until expiry for a PEM certificate file or a TLS endpoint",
                inputSchema: z.object({
                    target: z.string().describe("Absolute path to a certificate, or host[:port] (default port 443)")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ target }) => text(await security.checkCertificate(target))
        );
    }

    async initOptionalPlugins(signal?: AbortSignal): Promise<void> {
        // Optional plugin detection is deliberately separate from construction:
        // core tools are registered synchronously in the constructor so the
        // local server can connect before probing optional host capabilities.
        const allPlugins = [
            new VmPlugin(),
            new ContainerPlugin(),
            new ZfsPlugin(),
            new SmartPlugin()
        ];

        if (signal?.aborted)
            throw new DOMException("Optional plugin setup aborted", "AbortError");

        const detected = await Promise.all(allPlugins.map(async plugin => ({
            plugin,
            available: await plugin.detect()
        })));
        for (const { plugin, available } of detected) {
            if (signal?.aborted)
                throw new DOMException("Optional plugin setup aborted", "AbortError");
            if (available) {
                this.plugins.push(plugin);
                // McpServer 1.26.0 sends tools/list_changed after registration
                // when the server is already connected.
                plugin.register(this.server);
            }
        }
    }

    async connect(transport: Transport) {
        await this.server.connect(transport);
    }
}
