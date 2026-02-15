/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ToolPlugin } from "./base.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class ZfsPlugin extends ToolPlugin {
    get name(): string {
        return "zfs";
    }

    get description(): string {
        return "ZFS management";
    }

    async detect(): Promise<boolean> {
        try {
            await cockpit.spawn(["which", "zpool"]);
            return true;
        } catch {
            return false;
        }
    }

    register(server: McpServer): void {
        server.registerTool(
            "zpool_status",
            {
                title: "ZFS pool status",
                description: "Get ZFS pool status",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true },
            },
            async () => {
                const result = await this.run(["zpool", "status"]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "zfs_list",
            {
                title: "List ZFS datasets",
                description: "List ZFS datasets and zvols",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true },
            },
            async () => {
                const result = await this.run(["zfs", "list"]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "zfs_snapshot",
            {
                title: "Create ZFS snapshot",
                description: "Create a ZFS snapshot",
                inputSchema: z.object({
                    name: z.string().describe("Pool name"),
                })
            },
            async ({ name }) => {
                // Use YYYYMMDDHHMMSS as snapshot name
                const snapshot = new Date().toISOString().replace(/[-T:.]/g, '').slice(0, 14);
                const result = await this.run(["zfs", "snapshot", `${name}@agent-${snapshot}`], 'require');
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "zfs_snapshot_list",
            {
                title: "List ZFS snapshots",
                description: "List ZFS snapshots",
                inputSchema: z.object({
                    name: z.string().describe("Pool name"),
                }),
                _meta: { isLowRisk: true },
            },
            async ({ name }) => {
                const result = await this.run(["zfs", "list", "-t", "snapshot", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "zfs_snapshot_delete",
            {
                title: "Delete ZFS snapshot",
                description: "Delete a ZFS snapshot",
                inputSchema: z.object({
                    name: z.string().describe("Pool name"),
                })
            },
            async ({ name }) => {
                const result = await this.run(["zfs", "destroy", name], 'require');
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "zfs_snapshot_rollback",
            {
                title: "Rollback ZFS snapshot",
                description: "Rollback a ZFS snapshot",
                inputSchema: z.object({
                    name: z.string().describe("Pool name"),
                })
            },
            async ({ name }) => {
                const result = await this.run(["zfs", "rollback", name], 'require');
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "zfs_create",
            {
                title: "Create ZFS dataset",
                description: "Create a ZFS dataset",
                inputSchema: z.object({
                    pool: z.string().describe("Pool name"),
                    name: z.string().describe("Name"),
                    type: z.enum(["volume", "sparse_volume", "dataset"]),
                    size: z.string().optional().describe("Size (e.g. 10G)"),
                    blocksize: z.string().optional().describe("Block size (optional, e.g. 64k)")
                })
            },
            async ({ pool, name, type, size, blocksize }) => {
                const cmd = ["zfs", "create"];
                switch (type) {
                    case "sparse_volume":
                        if (!size) {
                            throw new Error("Size is required for sparse volume");
                        }
                        cmd.push("-s", "-V", size);
                        break;
                    case "volume":
                        if (!size) {
                            throw new Error("Size is required for volume");
                        }
                        cmd.push("-V", size);
                        break;
                    case "dataset":
                        if (size) {
                            cmd.push("-o", `quota=${size}`);
                        }
                        break;
                    default:
                        throw new Error(`Invalid type: ${type}`);
                }
                if (blocksize) {
                    cmd.push("-o", `volblocksize=${blocksize}`);
                }
                const fullName = `${pool}/${name}`;
                cmd.push(fullName);
                const result = await this.run(cmd, 'require');
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );
    }

    private async run(cmd: string[], su: 'require' | 'try' | null = null): Promise<string> {
        try {
            return await cockpit.spawn(cmd, { superuser: su });
        } catch (e: any) {
            return `Error running ${cmd[0]}: ${e.message || e.stderr || e}`;
        }
    }
}
