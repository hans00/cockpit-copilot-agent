/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolPlugin } from "./base.js";

export class FsPlugin extends ToolPlugin {
    private hasZfs = false;
    private hasSmart = false;

    get name(): string {
        return "filesystems";
    }

    get description(): string {
        return "Filesystem & Disk management (ZFS, SMART)";
    }

    async detect(): Promise<boolean> {
        try {
            await cockpit.spawn(["which", "zpool"]);
            this.hasZfs = true;
        } catch {
            this.hasZfs = false;
        }

        try {
            await cockpit.spawn(["which", "smartctl"]);
            this.hasSmart = true;
        } catch {
            this.hasSmart = false;
        }

        return true; // Always available for lsblk
    }

    getTools(): Tool[] {
        const tools: Tool[] = [
            {
                name: "disk_list",
                description: "List block devices (lsblk)",
                inputSchema: { type: "object", properties: {} }
            }
        ];

        if (this.hasZfs) {
            tools.push(
                {
                    name: "zpool_status",
                    description: "Get ZFS pool status",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "zfs_list",
                    description: "List ZFS datasets and zvols",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "zvol_create",
                    description: "Create a ZFS volume (zvol)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            pool: { type: "string", description: "Pool name" },
                            name: { type: "string", description: "Volume name" },
                            size: { type: "string", description: "Size (e.g. 10G)" },
                            blocksize: { type: "string", description: "Block size (optional, e.g. 64k)" }
                        },
                        required: ["pool", "name", "size"]
                    }
                }
            );
        }

        if (this.hasSmart) {
            tools.push({
                name: "smart_health",
                description: "Check SMART health of a disk",
                inputSchema: {
                    type: "object",
                    properties: { device: { type: "string", description: "Device path (e.g. /dev/sda)" } },
                    required: ["device"]
                }
            });
        }

        return tools;
    }

    async execute(toolName: string, args: Record<string, any>): Promise<any> {
        switch (toolName) {
            case "disk_list":
                return this.run(["lsblk", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT"]);
            case "zpool_status":
                return this.run(["zpool", "status"]);
            case "zfs_list":
                return this.run(["zfs", "list"]);
            case "zvol_create": {
                const cmd = ["zfs", "create", "-V", args.size];
                if (args.blocksize) {
                    cmd.push("-o", `volblocksize=${args.blocksize}`);
                }
                const fullName = `${args.pool}/${args.name}`;
                cmd.push(fullName);
                return this.run(cmd);
            }
            case "smart_health":
                return this.run(["smartctl", "-H", args.device]);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async run(cmd: string[]): Promise<string> {
        try {
            return await cockpit.spawn(cmd);
        } catch (e: any) {
            return `Error running ${cmd[0]}: ${e.message || e.stderr || e}`;
        }
    }
}
