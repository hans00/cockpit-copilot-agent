/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ToolPlugin } from "./base.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

    register(server: McpServer): void {
        server.registerTool(
            "container_list",
            {
                title: "List containers",
                description: "List containers (running and stopped)",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true }
            },
            async () => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const result = await this.runRuntime([this.runtime, "ps", "-a", "--format", "{{.ID}} {{.Names}} {{.Image}} {{.Status}}"]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "container_inspect",
            {
                title: "Inspect container",
                description: "Inspect a container",
                inputSchema: z.object({
                    name: z.string().describe("Container name")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ name }) => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const result = await this.runRuntime([this.runtime, "inspect", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "container_logs",
            {
                title: "Container logs",
                description: "Get logs of a container",
                inputSchema: z.object({
                    name: z.string().describe("Container name")
                }),
                _meta: { isLowRisk: true }
            },
            async ({ name }) => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const result = await this.runRuntime([this.runtime, "logs", "--tail", "50", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "container_start",
            {
                title: "Start container",
                description: "Start a container",
                inputSchema: z.object({
                    name: z.string().describe("Container name"),
                    daemon: z.boolean().optional()
                            .describe("If true, setup as a user systemd service")
                })
            },
            async ({ name, daemon }) => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const res = await this.runRuntime([this.runtime, "start", name]);
                if (daemon && this.runtime === "podman") {
                    const systemdRes = await this.setupSystemd(name);
                    return {
                        content: [{ type: "text", text: `${res}\n\nSystemd Setup:\n${systemdRes}` }]
                    };
                }
                return {
                    content: [{ type: "text", text: res }]
                };
            }
        );

        server.registerTool(
            "container_stop",
            {
                title: "Stop container",
                description: "Stop a container",
                inputSchema: z.object({
                    name: z.string().describe("Container name")
                })
            },
            async ({ name }) => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const result = await this.runRuntime([this.runtime, "stop", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "container_rm",
            {
                title: "Remove container",
                description: "Remove a container",
                inputSchema: z.object({
                    name: z.string().describe("Container name")
                })
            },
            async ({ name }) => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const result = await this.runRuntime([this.runtime, "rm", name]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "image_list",
            {
                title: "List images",
                description: "List container images",
                inputSchema: z.object({}),
                _meta: { isLowRisk: true },
            },
            async () => {
                if (!this.runtime) throw new Error("Container runtime not detected");
                const result = await this.runRuntime([this.runtime, "images"]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "container_run",
            {
                title: "Run a container",
                description: "Run a new container",
                inputSchema: z.object({
                    image: z.string().describe("Image name (e.g. alpine:latest)"),
                    name: z.string().optional()
                            .describe("Container name (highly recommended)"),
                    ports: z.array(z.object({
                        host: z.string().describe("Host port"),
                        container: z.string().describe("Container port")
                    })).optional()
                            .describe("Port mappings (e.g. 8080:80)"),
                    vols: z.array(z.object({
                        host: z.string().describe("Host path"),
                        container: z.string().describe("Container path"),
                        flags: z.string().optional()
                                .describe("Volume flags (e.g. ro)"),
                    })).optional()
                            .describe("Volume mappings (e.g. /host:/container)"),
                    env: z.array(z.string()).optional()
                            .describe("Environment variables (e.g. KEY=VAL)"),
                    detach: z.boolean().default(true)
                            .describe("Run in background (default true)"),
                    network: z.string().optional()
                            .describe("Network mode (e.g. bridge, host)"),
                    restart: z.string().optional()
                            .describe("Restart policy (e.g. always, on-failure)"),
                    memory: z.string().optional()
                            .describe("Memory limit (e.g. 512m)"),
                    cpu: z.string().optional()
                            .describe("CPU limit (e.g. 1.0)"),
                    daemon: z.boolean().optional()
                            .describe("If true, automatically setup as a user systemd service"),
                    gid: z.string().optional()
                            .describe("Container group id (e.g. 1000)"),
                    uid: z.string().optional()
                            .describe("Container user id (e.g. 1000)"),
                })
            },
            async (args) => {
                if (!this.runtime) throw new Error("Container runtime not detected");

                const cmd = [this.runtime, "run"];
                if (args.detach !== false) cmd.push("-d");
                if (args.name) cmd.push("--name", args.name);
                if (args.network) cmd.push("--network", args.network);
                if (args.restart) cmd.push("--restart", args.restart);
                if (args.memory) cmd.push("--memory", args.memory);
                if (args.cpu) cmd.push("--cpu", args.cpu);
                if (args.gid) cmd.push("--gid", args.gid);
                if (args.uid) cmd.push("--uid", args.uid);
                (args.ports || []).forEach((p) => cmd.push("-p", `${p.host}:${p.container}`));
                (args.vols || []).forEach((v) => cmd.push("-v", `${v.host}:${v.container}${v.flags ? `:${v.flags}` : ""}`));
                (args.env || []).forEach((e) => cmd.push("-e", e));
                cmd.push(args.image);

                const res = await this.runRuntime(cmd);
                if (args.daemon && args.name && this.runtime === "podman") {
                    const systemdRes = await this.setupSystemd(args.name);
                    return {
                        content: [{ type: "text", text: `${res}\n\nSystemd Setup:\n${systemdRes}` }]
                    };
                }

                // Fix volume permission for podman
                if (this.runtime === "podman" && args.vols && args.uid && args.gid) {
                    // podman unshare chown -R <container_uid>:<container_gid> <host_path>
                    for (const vol of args.vols) {
                        await this.runRuntime(["podman", "unshare", "chown", "-R", `${args.uid}:${args.gid}`, vol.host]);
                    }
                }

                return {
                    content: [{ type: "text", text: res }]
                };
            }
        );
    }

    private async setupSystemd(containerName: string): Promise<string> {
        try {
            // 1. Enable linger to ensure service runs after logout
            const user = cockpit.info.user.name;
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

                return `Successfully installed and enabled systemd service: container-${containerName}.service (User mode)`;
            } else {
                // root mode
                await cockpit.script(`podman generate systemd --name ${escapeShellArg(containerName)} > ${escapeShellArg(`/etc/systemd/system/container-${containerName}.service`)}`);
                await cockpit.spawn(["systemctl", "daemon-reload"]);
                await cockpit.spawn(["systemctl", "enable", "--now", `container-${containerName}.service`]);

                return `Successfully installed and enabled systemd service: container-${containerName}.service`;
            }
        } catch (e: unknown) {
            return `Failed to setup systemd service: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    private async runRuntime(cmd: string[]): Promise<string> {
        try {
            if (cmd[0] === "docker") {
                return await cockpit.spawn(cmd, { superuser: "try" });
            }
            return await cockpit.spawn(cmd);
        } catch (e: unknown) {
            return `Error running ${cmd[0]}: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
