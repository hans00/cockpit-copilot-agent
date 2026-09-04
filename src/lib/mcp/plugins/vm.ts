/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ToolPlugin } from "./base.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class VmPlugin extends ToolPlugin {
    get name(): string {
        return "vm";
    }

    get description(): string {
        return "Virtual Machine management (libvirt/virsh)";
    }

    async detect(): Promise<boolean> {
        try {
            await cockpit.spawn(["which", "virsh"]);
            return true;
        } catch {
            return false;
        }
    }

    register(server: McpServer): void {
        server.registerTool(
            "vm_list",
            {
                title: "List VMs",
                description: "List all VMs with state (running, shut off)",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true },
            },
            async () => {
                const result = await this.runVirsh(["list", "--all"]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "vm_info",
            {
                title: "VM info",
                description: "Get detailed info about a specific VM",
                inputSchema: z.object({
                    name: z.string().describe("Name of the VM")
                }),
                _meta: { isLowRisk: true },
            },
            async ({ name }) => {
                const result = await this.runVirsh(["dominfo", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "vm_start",
            {
                title: "Start VM",
                description: "Start a VM",
                inputSchema: z.object({
                    name: z.string().describe("Name of the VM")
                })
            },
            async ({ name }) => {
                const result = await this.runVirsh(["start", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "vm_stop",
            {
                title: "Stop VM",
                description: "Shutdown a VM gracefully",
                inputSchema: z.object({
                    name: z.string().describe("Name of the VM")
                })
            },
            async ({ name }) => {
                const result = await this.runVirsh(["shutdown", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "vm_reboot",
            {
                title: "Reboot VM",
                description: "Reboot a VM",
                inputSchema: z.object({
                    name: z.string().describe("Name of the VM")
                })
            },
            async ({ name }) => {
                const result = await this.runVirsh(["reboot", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "vm_snapshot_list",
            {
                title: "List VM snapshots",
                description: "List snapshots of a VM",
                inputSchema: z.object({
                    name: z.string().describe("Name of the VM")
                }),
                _meta: { isLowRisk: true },
            },
            async ({ name }) => {
                const result = await this.runVirsh(["snapshot-list", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "vm_create",
            {
                title: "Create VM",
                description: "Create a new VM using virt-install (requires root)",
                inputSchema: z.object({
                    name: z.string().describe("VM Name"),
                    vcpu: z.number().int()
                            .describe("Number of vCPUs"),
                    ram_mb: z.number().int()
                            .describe("RAM in MB"),
                    disk_path: z.string().describe("Path to disk image or zvol (e.g. /dev/zvol/pool/name)"),
                    iso_path: z.string().describe("Path to installer ISO"),
                    os_variant: z.string().optional()
                            .describe("OS variant (e.g. ubuntu22.04)")
                })
            },
            async (args) => {
                try {
                    await cockpit.spawn(["which", "virt-install"]);
                } catch {
                    return {
                        content: [{ type: "text", text: "Error: virt-install is not installed." }],
                        isError: true
                    };
                }
                const cmd = [
                    "virt-install",
                    "--name", args.name,
                    "--vcpus", args.vcpu.toString(),
                    "--memory", args.ram_mb.toString(),
                    "--disk", `path=${args.disk_path}`,
                    "--cdrom", args.iso_path,
                    "--os-variant", args.os_variant || "generic",
                    "--noautoconsole",
                    "--graphics", "vnc"
                ];
                let result = "";

                try {
                    result = await cockpit.spawn(cmd, { superuser: "require" });
                } catch (e: unknown) {
                    return {
                        content: [{ type: "text", text: `Error creating VM: ${e instanceof Error ? e.message : String(e)}` }],
                        isError: true
                    };
                }
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );
    }

    private async runVirsh(cmdArgs: string[]): Promise<string> {
        try {
            return await cockpit.spawn(["virsh", ...cmdArgs]);
        } catch (e: unknown) {
            return `Error running virsh: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
