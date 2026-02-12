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

// Plugins
import { ToolPlugin } from "./plugins/base.js";
import { VmPlugin } from "./plugins/vm.js";
import { ContainerPlugin } from "./plugins/containers.js";
import { ZfsPlugin } from "./plugins/zfs.js";
import { SmartPlugin } from "./plugins/smart.js";

export class McpServerLocal {
    private server: McpServer;
    private plugins: ToolPlugin[] = [];

    constructor() {
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

        this.setupTools();
    }

    private setupTools() {
        // Systemd
        this.server.registerTool(
            "service_list",
            {
                title: "List services",
                description: "List all systemd units",
                inputSchema: z.object({
                    scope: z.enum(["system", "user"]).default("system").describe("Systemd scope")
                })
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
                    scope: z.enum(["system", "user"]).default("system").describe("Systemd scope")
                })
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
                    scope: z.enum(["system", "user"]).default("system").describe("Systemd scope")
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
                })
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
                })
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
                })
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
                inputSchema: z.object({})
            },
            async () => {
                const result = await network.getInfo();
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
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
                inputSchema: z.object({})
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
                    service: z.string().optional().describe("Filter by systemd unit"),
                    lines: z.number().default(50).describe("Number of lines")
                })
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
                inputSchema: z.object({})
            },
            async () => {
                const result = await this.getSystemInfo();
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );
    }

    private async getSystemInfo(): Promise<string> {
        try {
            const hostname = (await cockpit.spawn(["hostname"])).trim();
            const uptime = (await cockpit.spawn(["uptime", "-p"])).trim();
            return `Hostname: ${hostname}\nUptime: ${uptime}`;
        } catch (e: any) {
            return `Error getting system info: ${e.message || e}`;
        }
    }

    async init() {
        // Initialize plugins
        const allPlugins = [
            new VmPlugin(),
            new ContainerPlugin(),
            new ZfsPlugin(),
            new SmartPlugin()
        ];

        for (const plugin of allPlugins) {
            if (await plugin.detect()) {
                this.plugins.push(plugin);
                // Register plugin tools
                plugin.register(this.server);
            }
        }
    }

    async connect(transport: Transport) {
        await this.server.connect(transport);
    }
}
