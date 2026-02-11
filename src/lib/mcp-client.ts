/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit, { Spawn } from "cockpit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { McpServerConfig, McpTool } from "./types.js";
import { LocalTransport } from "./mcp/local-transport.js";

// Custom Transport for Cockpit Spawn (Stdio)
class CockpitStdioTransport implements Transport {
    private process: Spawn<string> | undefined;
    private buffer = "";
    private config: McpServerConfig;

    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    constructor(config: McpServerConfig) {
        this.config = config;
    }

    async start(): Promise<void> {
        const command = this.config.command;
        if (!command) throw new Error("No command specified for stdio server");

        return new Promise((resolve, reject) => {
            try {
                this.process = cockpit.spawn([command, ...(this.config.args || [])], {
                    superuser: "try",
                    environ: ["PYTHONUNBUFFERED=1"]
                });

                this.process?.stream((data: string) => {
                    this.handleData(data);
                })
                    .fail((err: Error) => {
                        if (this.onerror) this.onerror(err);
                        reject(err);
                    })
                    .done(() => {
                        if (this.onclose) this.onclose();
                    });

                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!this.process) throw new Error("Process not started");
        const json = JSON.stringify(message);
        this.process.input(json + "\n");
    }

    async close(): Promise<void> {
        this.process?.close?.();
        this.process = undefined;
    }

    private handleData(data: string) {
        this.buffer += data;

        let idx;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, idx).trim();
            this.buffer = this.buffer.substring(idx + 1);

            if (line) {
                try {
                    const msg = JSON.parse(line);
                    if (this.onmessage) {
                        this.onmessage(msg);
                    }
                } catch (e) {
                    console.error("Failed to parse JSON-RPC message:", line, e);
                    if (this.onerror) this.onerror(e as Error);
                }
            }
        }
    }
}

interface ConnectedClient {
    client: Client;
    transport: Transport;
    config: McpServerConfig;
}

// Manager to handle multiple clients
export class McpClientManager {
    private clients: Map<string, ConnectedClient> = new Map();

    async connectServer(config: McpServerConfig, localTransport?: LocalTransport) {
        let transport: Transport;

        if (localTransport) {
            transport = localTransport;
        } else if (config.transport === "stdio") {
            transport = new CockpitStdioTransport(config);
        } else if (config.transport === "http") {
            if (!config.url) throw new Error("No URL specified for HTTP server");
            transport = new StreamableHTTPClientTransport(new URL(config.url)) as Transport;
        } else if (config.transport === "local") {
            throw new Error("Local transport requires an existing transport instance");
        } else {
            console.warn(`Unknown transport: ${(config as any).transport} `);
            return;
        }

        const client = new Client({
            name: "cockpit-copilot-agent",
            version: "0.1.0"
        });

        try {
            await client.connect(transport);
            this.clients.set(config.id, { client, transport, config });
        } catch (e) {
            console.error(`Failed to connect to server ${config.name}: `, e);
            try { await transport.close() } catch { } // Ensure closed
        }
    }

    async listAllTools(): Promise<{ serverId: string, originalName: string, tool: McpTool }[]> {
        let allTools: { serverId: string, originalName: string, tool: McpTool }[] = [];

        for (const [id, conn] of this.clients.entries()) {
            try {
                const result = await conn.client.listTools();
                const serverName = conn.config.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

                allTools = allTools.concat(result.tools.map(t => ({
                    serverId: id,
                    originalName: t.name,
                    tool: {
                        name: `${serverName}__${t.name}`,
                        description: t.description || "",
                        inputSchema: t.inputSchema
                    } as McpTool
                })));
            } catch (e) {
                console.error(`Error listing tools for server ${id}:`, e);
            }
        }
        return allTools;
    }

    async callTool(serverId: string, toolName: string, args: any): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
        const conn = this.clients.get(serverId);
        if (!conn) throw new Error(`Server ${serverId} not found`);

        const result = await conn.client.callTool({
            name: toolName,
            arguments: args
        });

        if (result.content && Array.isArray(result.content)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return result.content.map((c: any) => {
                if (c.type === 'text') return c.text;
                if (c.type === 'image') return `[Image: ${c.mimeType}]`;
                return JSON.stringify(c);
            }).join("\n");
        }

        return JSON.stringify(result);
    }

    async close() {
        for (const conn of this.clients.values()) {
            await conn.client.close();
            await conn.transport.close();
        }
        this.clients.clear();
    }
}
