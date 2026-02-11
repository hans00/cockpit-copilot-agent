/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolPlugin } from "./base.js";

const escapeShellArg = (arg: string): string => {
    return `'${arg.replace(/'/g, "'\\''")}'`;
};

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
                    properties: { 
                        name: { type: "string" },
                        daemon: { type: "boolean", description: "If true, setup as a user systemd service" }
                    },
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
                            description: "Container name (highly recommended)"
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
                        },
                        network: {
                            type: "string",
                            description: "Network mode (e.g. bridge, host)"
                        },
                        restart: {
                            type: "string",
                            description: "Restart policy (e.g. always, on-failure)"
                        },
                        memory: {
                            type: "string",
                            description: "Memory limit (e.g. 512m)"
                        },
                        cpu: {
                            type: "string",
                            description: "CPU limit (e.g. 1.0)"
                        },
                        daemon: {
                            type: "boolean",
                            description: "If true, automatically setup as a user systemd service (survives logout)"
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
            case "container_start": {
                const res = await this.runRuntime([this.runtime, "start", args.name]);
                if (args.daemon && this.runtime === "podman") {
                    const systemdRes = await this.setupSystemd(args.name);
                    return `${res}\n\nSystemd Setup:\n${systemdRes}`;
                }
                return res;
            }
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
                if (args.network) cmd.push("--network", args.network);
                if (args.restart) cmd.push("--restart", args.restart);
                if (args.memory) cmd.push("--memory", args.memory);
                if (args.cpu) cmd.push("--cpu", args.cpu);
                (args.ports || []).forEach((p: string) => cmd.push("-p", p));
                (args.vols || []).forEach((v: string) => cmd.push("-v", v));
                (args.env || []).forEach((e: string) => cmd.push("-e", e));
                cmd.push(args.image);
                
                const res = await this.runRuntime(cmd);
                if (args.daemon && args.name && this.runtime === "podman") {
                    const systemdRes = await this.setupSystemd(args.name);
                    return `${res}\n\nSystemd Setup:\n${systemdRes}`;
                }
                return res;
            }
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async setupSystemd(containerName: string): Promise<string> {
        try {
            // 1. Enable linger to ensure service runs after logout
            const user = await cockpit.script("whoami").then(o => o.trim());
            if (user !== "root") {
                // Get user home directory
                const homeDir = cockpit.info.user.home;

                await cockpit.spawn(["loginctl", "enable-linger", user], { superuser: "require" }).catch(() => {});

                // 2. Generate systemd unit files
                // podman generate systemd --name <name> > ~/.config/systemd/user/container-<name>.service
                // This creates a file like container-<name>.service in the CWD
                await cockpit.script(`podman generate systemd --name ${escapeShellArg(containerName)} > ${escapeShellArg(`${homeDir}/.config/systemd/user/container-${containerName}.service`)}`);

                // 5. Reload and enable
                await cockpit.spawn(["systemctl", "--user", "daemon-reload"]);
                await cockpit.spawn(["systemctl", "--user", "enable", "--now", `container-${containerName}.service`]);
            } else {
                // root mode
                await cockpit.spawn([
                    "podman", "generate", "systemd", "--name", containerName,
                    ">", `/etc/systemd/system/container-${containerName}.service`
                ]);
                await cockpit.spawn(["systemctl", "daemon-reload"]);
                await cockpit.spawn(["systemctl", "enable", "--now", `container-${containerName}.service`]);
            }

            return `Successfully installed and enabled systemd service: container-${containerName}.service (User mode)`;
        } catch (e: any) {
            return `Failed to setup systemd service: ${e.message || e.stderr || e}`;
        }
    }

    private async runRuntime(cmd: string[]): Promise<string> {
        try {
            if (cmd[0] === "docker") {
                return await cockpit.spawn(cmd, { superuser: "try" });
            }
            return await cockpit.spawn(cmd);
        } catch (e: any) {
            return `Error running ${cmd[0]}: ${e.message || e.stderr || e}`;
        }
    }
}
