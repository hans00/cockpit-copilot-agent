/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolPlugin } from "./base.js";

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

    getTools(): Tool[] {
        return [
            {
                name: "vm_list",
                description: "List all VMs with state (running, shut off)",
                inputSchema: {
                    type: "object",
                    properties: {},
                }
            },
            {
                name: "vm_info",
                description: "Get detailed info about a specific VM",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Name of the VM" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "vm_start",
                description: "Start a VM",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "vm_stop",
                description: "Shutdown a VM gracefully",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "vm_reboot",
                description: "Reboot a VM",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "vm_snapshot_list",
                description: "List snapshots of a VM",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "vm_create",
                description: "Create a new VM using virt-install (requires root)",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "VM Name"
                        },
                        vcpu: {
                            type: "integer",
                            description: "Number of vCPUs"
                        },
                        ram_mb: {
                            type: "integer",
                            description: "RAM in MB"
                        },
                        disk_path: {
                            type: "string",
                            description: "Path to disk image or zvol (e.g. /dev/zvol/pool/name)"
                        },
                        iso_path: {
                            type: "string",
                            description: "Path to installer ISO"
                        },
                        os_variant: {
                            type: "string",
                            description: "OS variant (e.g. ubuntu22.04), optional"
                        }
                    },
                    required: ["name", "vcpu", "ram_mb", "disk_path", "iso_path"]
                }
            }
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<any> {
        switch (toolName) {
            case "vm_list":
                return this.runVirsh(["list", "--all"]);
            case "vm_info":
                return this.runVirsh(["dominfo", args.name]);
            case "vm_start":
                return this.runVirsh(["start", args.name]);
            case "vm_stop":
                return this.runVirsh(["shutdown", args.name]);
            case "vm_reboot":
                return this.runVirsh(["reboot", args.name]);
            case "vm_snapshot_list":
                return this.runVirsh(["snapshot-list", args.name]);
            case "vm_create":
                return this.createVm(args);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async runVirsh(cmdArgs: string[]): Promise<string> {
        try {
            return await cockpit.spawn(["virsh", ...cmdArgs]);
        } catch (e: any) {
            return `Error running virsh: ${e.message || e.stderr || e}`;
        }
    }

    private async createVm(args: Record<string, any>): Promise<string> {
        try {
            await cockpit.spawn(["which", "virt-install"]);
        } catch {
            return "Error: virt-install is not installed.";
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

        try {
            const result = await cockpit.spawn(cmd, { superuser: "require" });
            return `VM creation started successfully:\n${result}`;
        } catch (e: any) {
            return `Error creating VM: ${e.message || e.stderr || e}`;
        }
    }
}
