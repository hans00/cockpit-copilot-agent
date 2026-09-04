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

// Plugins
import { ToolPlugin } from "./plugins/base.js";
import { VmPlugin } from "./plugins/vm.js";
import { ContainerPlugin } from "./plugins/containers.js";
import { ZfsPlugin } from "./plugins/zfs.js";
import { SmartPlugin } from "./plugins/smart.js";

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

        // Logs
        this.server.registerTool(
            "journal_query",
            {
                title: "Query system logs",
                description: "Query system logs (journalctl)",
                inputSchema: z.object({
                    service: z.string().optional()
                            .describe("Filter by systemd unit"),
                    lines: z.number().default(50)
                            .describe("Number of lines")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ service, lines }) => {
                const result = await logs.queryJournal(service, lines);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        // System Info
        this.server.registerTool(
            "system_info",
            {
                title: "System info",
                description: "Get system hostname, OS, kernel, uptime",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => {
                const result = await this.getSystemInfo();
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

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
                // Append content to memory file
                let memory: string[] = [];
                const file = cockpit.file(memoryPath.replace("$HOME", cockpit.info.user.home));
                try {
                    try {
                        memory = JSON.parse(await file.read());
                    } catch {
                        // Ignore error
                    }
                    const result = await file.replace(JSON.stringify([...memory, content], null, 2));
                    return {
                        content: [{ type: "text", text: result }]
                    };
                } finally {
                    file.close();
                }
            }
        );
    }

    private async getSystemInfo(): Promise<string> {
        try {
            const hostname = (await cockpit.spawn(["hostname"])).trim();
            const uptime = (await cockpit.spawn(["uptime", "-p"])).trim();
            return `Hostname: ${hostname}\nUptime: ${uptime}`;
        } catch (e: unknown) {
            return `Error getting system info: ${e instanceof Error ? e.message : String(e)}`;
        }
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
