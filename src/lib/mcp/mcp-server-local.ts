/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { 
    CallToolRequestSchema, 
    ListToolsRequestSchema,
    CallToolRequest,
    ListToolsRequest
} from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// Core tools
import * as systemd from "./tools/systemd.js";
import * as packages from "./tools/packages.js";
import * as files from "./tools/files.js";
import * as network from "./tools/network.js";
import * as users from "./tools/users.js";
import * as logs from "./tools/logs.js";

// Plugins
import { ToolPlugin } from "./plugins/base.js";
import { VmPlugin } from "./plugins/vm.js";
import { ContainerPlugin } from "./plugins/containers.js";
import { FsPlugin } from "./plugins/filesystems.js";

export class McpServerLocal {
    private server: Server;
    private plugins: ToolPlugin[] = [];

    constructor() {
        this.server = new Server(
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

        this.setupHandlers();
    }

    private setupHandlers() {
        // List tools handler
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools: any[] = [
                // Systemd
                {
                    name: "service_list",
                    description: "List all systemd units",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "service_status",
                    description: "Get status of a systemd unit",
                    inputSchema: {
                        type: "object",
                        properties: { unit: { type: "string" } },
                        required: ["unit"]
                    }
                },
                {
                    name: "service_action",
                    description: "Start/stop/restart/enable/disable a systemd unit (requires root)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            unit: { type: "string" },
                            action: { type: "string", enum: ["start", "stop", "restart", "reload", "enable", "disable"] }
                        },
                        required: ["unit", "action"]
                    }
                },
                // Packages
                {
                    name: "package_search",
                    description: "Search available packages",
                    inputSchema: {
                        type: "object",
                        properties: { query: { type: "string" } },
                        required: ["query"]
                    }
                },
                {
                    name: "package_install",
                    description: "Install packages (requires root)",
                    inputSchema: {
                        type: "object",
                        properties: { packages: { type: "array", items: { type: "string" } } },
                        required: ["packages"]
                    }
                },
                {
                    name: "package_remove",
                    description: "Remove packages (requires root)",
                    inputSchema: {
                        type: "object",
                        properties: { packages: { type: "array", items: { type: "string" } } },
                        required: ["packages"]
                    }
                },
                // Files
                {
                    name: "file_read",
                    description: "Read file contents",
                    inputSchema: {
                        type: "object",
                        properties: { path: { type: "string" } },
                        required: ["path"]
                    }
                },
                {
                    name: "file_write",
                    description: "Write content to a file (requires root/permission)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            content: { type: "string" }
                        },
                        required: ["path", "content"]
                    }
                },
                {
                    name: "file_list",
                    description: "List directory contents",
                    inputSchema: {
                        type: "object",
                        properties: { path: { type: "string" } },
                        required: ["path"]
                    }
                },
                // Network
                {
                    name: "network_info",
                    description: "Show network interfaces and IPs",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "file_download",
                    description: "Download a file from a URL to a local path",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: { type: "string" },
                            dest: { type: "string" }
                        },
                        required: ["url", "dest"]
                    }
                },
                // Users
                {
                    name: "user_list",
                    description: "List system users",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "user_add",
                    description: "Create a new user (requires root)",
                    inputSchema: {
                        type: "object",
                        properties: { username: { type: "string" } },
                        required: ["username"]
                    }
                },
                // Logs
                {
                    name: "journal_query",
                    description: "Query system logs (journalctl)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            service: { type: "string", description: "Filter by systemd unit" },
                            lines: { type: "integer", default: 50 }
                        }
                    }
                },
                // System Info
                {
                    name: "system_info",
                    description: "Get system hostname, OS, kernel, uptime",
                    inputSchema: { type: "object", properties: {} }
                }
            ];

            // Add tools from enabled plugins
            for (const plugin of this.plugins) {
                tools.push(...plugin.getTools());
            }

            return { tools };
        });

        // Call tool handler
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                let result: any;
                switch (name) {
                    case "service_list":
                        result = await systemd.listUnits();
                        break;
                    case "service_status":
                        result = await systemd.getStatus(args?.unit as string);
                        break;
                    case "service_action":
                        result = await systemd.manageService(args?.unit as string, args?.action as string);
                        break;
                    case "package_search":
                        result = await packages.search(args?.query as string);
                        break;
                    case "package_install":
                        result = await packages.install(args?.packages as string[]);
                        break;
                    case "package_remove":
                        result = await packages.remove(args?.packages as string[]);
                        break;
                    case "file_read":
                        result = await files.readFile(args?.path as string);
                        break;
                    case "file_write":
                        result = await files.writeFile(args?.path as string, args?.content as string);
                        break;
                    case "file_list":
                        result = await files.listDir(args?.path as string);
                        break;
                    case "network_info":
                        result = await network.getInfo();
                        break;
                    case "file_download":
                        result = await network.downloadFile(args?.url as string, args?.dest as string);
                        break;
                    case "user_list":
                        result = await users.listUsers();
                        break;
                    case "user_add":
                        result = await users.addUser(args?.username as string);
                        break;
                    case "journal_query":
                        result = await logs.queryJournal(args?.service as string, args?.lines as number);
                        break;
                    case "system_info":
                        result = await this.getSystemInfo();
                        break;
                    default:
                        // Check plugins
                        for (const plugin of this.plugins) {
                            if (plugin.getTools().some(t => t.name === name)) {
                                result = await plugin.execute(name, args as Record<string, any>);
                                return {
                                    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }]
                                };
                            }
                        }
                        throw new Error(`Unknown tool: ${name}`);
                }

                return {
                    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }]
                };
            } catch (e: any) {
                return {
                    content: [{ type: "text", text: `Error: ${e.message || e}` }],
                    isError: true
                };
            }
        });
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
            new FsPlugin()
        ];

        for (const plugin of allPlugins) {
            if (await plugin.detect()) {
                this.plugins.push(plugin);
            }
        }
    }

    async connect(transport: Transport) {
        await this.server.connect(transport);
    }
}
