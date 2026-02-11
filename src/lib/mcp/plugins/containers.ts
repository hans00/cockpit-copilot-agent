/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolPlugin } from "./base.js";

export class ContainerPlugin extends ToolPlugin {
    private runtime: "podman" | "docker" | null = null;

    get name(): string {
        return "containers";
    }

    get description(): string {
        return "Container management (podman/docker)";
    }

    async detect(): Promise<boolean> {
        try {
            await cockpit.spawn(["which", "podman"]);
            this.runtime = "podman";
            return true;
        } catch {
            try {
                await cockpit.spawn(["which", "docker"]);
                this.runtime = "docker";
                return true;
            } catch {
                return false;
            }
        }
    }

    getTools(): Tool[] {
        return [
            {
                name: "container_list",
                description: "List containers (running and stopped)",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "container_inspect",
                description: "Inspect a container",
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                }
            },
            {
                name: "container_logs",
                description: "Get logs of a container",
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                }
            },
            {
                name: "container_start",
                description: "Start a container",
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                }
            },
            {
                name: "container_stop",
                description: "Stop a container",
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                }
            },
            {
                name: "container_rm",
                description: "Remove a container",
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"]
                }
            },
            {
                name: "container_run",
                description: "Run a new container",
                inputSchema: {
                    type: "object",
                    properties: {
                        image: {
                            type: "string",
                            description: "Image name (e.g. alpine:latest)"
                        },
                        name: {
                            type: "string",
                            description: "Container name (optional)"
                        },
                        ports: {
                            type: "array",
                            items: { type: "string" },
                            description: "Port mappings (e.g. 8080:80)"
                        },
                        vols: {
                            type: "array",
                            items: { type: "string" },
                            description: "Volume mappings (e.g. /host:/container)"
                        },
                        env: {
                            type: "array",
                            items: { type: "string" },
                            description: "Environment variables (e.g. KEY=VAL)"
                        },
                        detach: {
                            type: "boolean",
                            description: "Run in background (default true)"
                        }
                    },
                    required: ["image"]
                }
            },
            {
                name: "image_list",
                description: "List container images",
                inputSchema: { type: "object", properties: {} }
            }
        ];
    }

    async execute(toolName: string, args: Record<string, any>): Promise<any> {
        if (!this.runtime) throw new Error("Container runtime not detected");

        switch (toolName) {
            case "container_list":
                return this.runRuntime([this.runtime, "ps", "-a", "--format", "{{.ID}} {{.Names}} {{.Image}} {{.Status}}"]);
            case "container_inspect":
                return this.runRuntime([this.runtime, "inspect", args.name]);
            case "container_logs":
                return this.runRuntime([this.runtime, "logs", "--tail", "50", args.name]);
            case "container_start":
                return this.runRuntime([this.runtime, "start", args.name]);
            case "container_stop":
                return this.runRuntime([this.runtime, "stop", args.name]);
            case "container_rm":
                return this.runRuntime([this.runtime, "rm", args.name]);
            case "image_list":
                return this.runRuntime([this.runtime, "images"]);
            case "container_run": {
                const cmd = [this.runtime, "run"];
                if (args.detach !== false) cmd.push("-d");
                if (args.name) cmd.push("--name", args.name);
                (args.ports || []).forEach((p: string) => cmd.push("-p", p));
                (args.vols || []).forEach((v: string) => cmd.push("-v", v));
                (args.env || []).forEach((e: string) => cmd.push("-e", e));
                cmd.push(args.image);
                return this.runRuntime(cmd);
            }
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async runRuntime(cmd: string[]): Promise<string> {
        try {
            return await cockpit.spawn(cmd);
        } catch (e: any) {
            return `Error running ${cmd[0]}: ${e.message || e.stderr || e}`;
        }
    }
}
