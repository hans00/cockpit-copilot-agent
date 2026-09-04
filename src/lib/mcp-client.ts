/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit, { Spawn } from "cockpit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { McpServerConfig, McpTool } from "./types.js";
import { LocalTransport } from "./mcp/local-transport.js";
import { diagnostics } from "./diagnostics.js";

const MCP_REQUEST_TIMEOUT_MS = 10000;
const MAX_TOOL_OUTPUT_LENGTH = 64 * 1024;

const isAbortError = (error: unknown): boolean =>
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");

const createAbortError = (): Error =>
    typeof DOMException !== "undefined"
        ? new DOMException("Request aborted", "AbortError")
        : Object.assign(new Error("Request aborted"), { name: "AbortError" });

type McpErrorClass = "aborted" | "timeout" | "error";
type McpMetricStatus = "ok" | "partial" | "aborted" | "error";

type RemoteTool = {
    name: string;
    title?: string;
    description?: string;
    inputSchema: McpTool["inputSchema"];
    _meta?: Record<string, unknown>;
};

const classifyMcpError = (error: unknown): McpErrorClass => {
    if (isAbortError(error))
        return "aborted";
    const name = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
    const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const message = error instanceof Error ? error.message : String(error);
    return /timeout|timed out/i.test(`${name} ${code} ${message}`) ? "timeout" : "error";
};

const aggregateStatus = (
    results: PromiseSettledResult<unknown>[],
    signal?: AbortSignal
): McpMetricStatus => {
    if (signal?.aborted || results.some(result => result.status === "rejected" && isAbortError(result.reason)))
        return "aborted";
    const failed = results.filter(result => result.status === "rejected").length;
    if (failed === 0)
        return "ok";
    return failed === results.length ? "error" : "partial";
};

const schemaBytesForTools = (tools: RemoteTool[]): number | undefined => {
    if (!diagnostics.isEnabled())
        return undefined;
    return tools.reduce((total, tool) => total + diagnostics.jsonBytes(tool.inputSchema), 0);
};

const metricServerId = (serverId: string, stage: unknown): string | undefined =>
    stage ? diagnostics.opaqueId(serverId) : undefined;

const abortErrorFromResults = (
    results: PromiseSettledResult<unknown>[],
    signal?: AbortSignal
): unknown | undefined => {
    const aborted = results.find(result => result.status === "rejected" && isAbortError(result.reason));
    if (aborted && aborted.status === "rejected")
        return aborted.reason;
    return signal?.aborted ? createAbortError() : undefined;
};

type ToolReference = {
    serverId: string;
    originalName: string;
    serverName: string;
    tool: RemoteTool;
};

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
        if (!command)
            throw new Error("No command specified for stdio server");

        this.process = cockpit.spawn([command, ...(this.config.args || [])], {
            // MCP stdio is a pipe protocol. PTY echo and line processing can
            // corrupt JSON-RPC frames and are not needed here.
            pty: false
        });
        this.process.stream((data: string) => this.handleData(data));
        this.process.fail((error: Error) => {
            this.onerror?.(error);
        });
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!this.process)
            throw new Error("Process not started");
        this.process.input(`${JSON.stringify(message)}\n`, true);
    }

    async close(): Promise<void> {
        this.process?.close();
        this.process = undefined;
        this.onclose?.();
    }

    private handleData(data: string): void {
        this.buffer += data;
        let index: number;
        while ((index = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, index).trim();
            this.buffer = this.buffer.slice(index + 1);
            if (!line)
                continue;
            try {
                this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
            } catch {
                console.warn("Ignored non-JSON output from stdio server:", line);
            }
        }
    }
}

interface ConnectedClient {
    client: Client;
    transport: Transport;
    config: McpServerConfig;
    tools?: RemoteTool[];
    toolsPromise?: Promise<RemoteTool[]>;
}

export class McpClientManager {
    private clients = new Map<string, ConnectedClient>();

    async connectServer(
        config: McpServerConfig,
        localTransport?: LocalTransport,
        signal?: AbortSignal
    ): Promise<boolean> {
        const stage = diagnostics.start("mcp.connect");
        let transport: Transport;
        try {
            if (signal?.aborted)
                throw createAbortError();
            if (localTransport) {
                transport = localTransport;
            } else if (config.transport === "stdio") {
                transport = new CockpitStdioTransport(config);
            } else if (config.transport === "http") {
                if (!config.url)
                    throw new Error("No URL specified for HTTP server");
                transport = new StreamableHTTPClientTransport(new URL(config.url)) as Transport;
            } else if (config.transport === "local") {
                throw new Error("Local transport requires an existing transport instance");
            } else {
                console.warn(`Unknown transport: ${String(config.transport)}`);
                diagnostics.end(stage, {
                    status: "error",
                    serverId: metricServerId(config.id, stage),
                    errorClass: "error"
                });
                return false;
            }
        } catch (error) {
            diagnostics.end(stage, {
                status: classifyMcpError(error),
                serverId: metricServerId(config.id, stage),
                errorClass: classifyMcpError(error)
            });
            throw error;
        }

        const client = new Client(
            { name: "cockpit-copilot-agent", version: "0.1.0" },
            {
                listChanged: {
                    tools: {
                        onChanged: (error, tools) => {
                            const connected = this.clients.get(config.id);
                            if (!connected)
                                return;
                            if (error) {
                                delete connected.tools;
                                console.error(`Failed to refresh tools for ${config.name}:`, error);
                            } else {
                                connected.tools = tools as RemoteTool[];
                            }
                        }
                    }
                }
            }
        );

        try {
            const connectOptions = signal
                ? { timeout: MCP_REQUEST_TIMEOUT_MS, signal }
                : { timeout: MCP_REQUEST_TIMEOUT_MS };
            await client.connect(transport, connectOptions);
            if (signal?.aborted) {
                try {
                    await client.close();
                } catch {
                    // The connection may already have been interrupted.
                }
                try {
                    await transport.close();
                } catch {
                    // The transport may already have been interrupted.
                }
                diagnostics.end(stage, {
                    status: "aborted",
                    transport: config.transport,
                    serverId: metricServerId(config.id, stage),
                    errorClass: "aborted"
                });
                return false;
            }
            this.clients.set(config.id, { client, transport, config });
            diagnostics.end(stage, {
                status: "ok",
                transport: config.transport,
                serverId: metricServerId(config.id, stage)
            });
            return true;
        } catch (error) {
            const errorClass = classifyMcpError(error);
            diagnostics.end(stage, {
                status: errorClass,
                transport: config.transport,
                serverId: metricServerId(config.id, stage),
                errorClass
            });
            if (errorClass !== "aborted")
                console.error(`Failed to connect to server ${config.name}:`, error);
            try {
                await client.close();
            } catch {
                // The client may not have completed initialization.
            }
            try {
                await transport.close();
            } catch {
                // The transport may already have failed during startup.
            }
            return false;
        }
    }

    async refreshTools(signal?: AbortSignal): Promise<void> {
        const stage = diagnostics.start("mcp.refresh_tools");
        const connections = Array.from(this.clients.values());
        if (signal?.aborted) {
            diagnostics.end(stage, { status: "aborted", serverCount: connections.length });
            throw createAbortError();
        }
        let results: PromiseSettledResult<RemoteTool[]>[];
        try {
            results = await Promise.allSettled(
                connections.map(connection => this.fetchTools(connection, true, signal))
            );
        } catch (error) {
            const errorClass = classifyMcpError(error);
            diagnostics.end(stage, {
                status: errorClass === "aborted" ? "aborted" : "error",
                serverCount: connections.length,
                errorClass
            });
            throw error;
        }
        const abortError = abortErrorFromResults(results, signal);
        if (abortError !== undefined) {
            diagnostics.end(stage, {
                status: "aborted",
                serverCount: results.length,
                failedServers: results.filter(result => result.status === "rejected").length
            });
            throw abortError;
        }
        const status = aggregateStatus(results, signal);
        const failedServers = results.filter(result => result.status === "rejected").length;
        const successfulTools = results
                .filter((result): result is PromiseFulfilledResult<RemoteTool[]> => result.status === "fulfilled")
                .flatMap(result => result.value);
        diagnostics.end(stage, {
            status,
            serverCount: results.length,
            failedServers,
            toolCount: successfulTools.length,
            totalToolSchemaBytes: schemaBytesForTools(successfulTools),
            forcedDiscovery: results.length
        });
    }

    async refreshToolsFor(serverId: string, signal?: AbortSignal): Promise<void> {
        const stage = diagnostics.start("mcp.refresh_tools");
        const metricId = metricServerId(serverId, stage);
        if (signal?.aborted) {
            diagnostics.end(stage, { status: "aborted", serverId: metricId });
            throw createAbortError();
        }

        const connection = this.clients.get(serverId);
        if (!connection) {
            diagnostics.end(stage, { status: "error", serverId: metricId, errorClass: "error" });
            throw new Error(`Server ${serverId} not found`);
        }

        try {
            const tools = await this.fetchTools(connection, true, signal);
            diagnostics.end(stage, {
                status: "ok",
                serverId: metricId,
                toolCount: tools.length,
                totalToolSchemaBytes: schemaBytesForTools(tools),
                forcedDiscovery: 1
            });
        } catch (error) {
            const errorClass = classifyMcpError(error);
            diagnostics.end(stage, {
                status: errorClass === "aborted" ? "aborted" : errorClass,
                serverId: metricId,
                errorClass
            });
            throw error;
        }
    }

    async listAllTools(signal?: AbortSignal): Promise<{ serverId: string; originalName: string; tool: McpTool }[]> {
        const stage = diagnostics.start("mcp.list_tools");
        const connections = Array.from(this.clients.values());
        if (signal?.aborted) {
            diagnostics.end(stage, { status: "aborted", serverCount: connections.length });
            throw createAbortError();
        }
        const cacheHits = diagnostics.isEnabled()
            ? connections.filter(connection => !!connection.tools && !connection.toolsPromise).length
            : undefined;
        const coalescedRequests = diagnostics.isEnabled()
            ? connections.filter(connection => !connection.tools && !!connection.toolsPromise).length
            : undefined;
        let results: PromiseSettledResult<RemoteTool[]>[];
        try {
            results = await Promise.allSettled(
                connections.map(connection => this.fetchTools(connection, false, signal))
            );
        } catch (error) {
            const errorClass = classifyMcpError(error);
            diagnostics.end(stage, {
                status: errorClass === "aborted" ? "aborted" : "error",
                serverCount: connections.length,
                errorClass
            });
            throw error;
        }
        const abortError = abortErrorFromResults(results, signal);
        if (abortError !== undefined) {
            diagnostics.end(stage, {
                status: "aborted",
                serverCount: results.length,
                failedServers: results.filter(result => result.status === "rejected").length
            });
            throw abortError;
        }

        const references: ToolReference[] = [];
        for (const connection of connections) {
            const serverName = connection.config.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
            for (const tool of connection.tools || []) {
                references.push({
                    serverId: connection.config.id,
                    originalName: tool.name,
                    serverName,
                    tool
                });
            }
        }

        const counts = new Map<string, number>();
        for (const reference of references)
            counts.set(reference.serverName, (counts.get(reference.serverName) || 0) + 1);

        const normalizedTools = references.map(reference => {
            const serverPrefix = counts.get(reference.serverName)! > 1
                ? `${reference.serverName}_${reference.serverId.slice(0, 8)}`
                : reference.serverName;
            const metadata = typeof reference.tool._meta?.isLowRisk === "boolean"
                ? { isLowRisk: reference.tool._meta.isLowRisk as boolean }
                : undefined;
            const normalizedTool: McpTool = {
                name: `${serverPrefix}__${reference.tool.name}`,
                inputSchema: reference.tool.inputSchema
            };
            if (reference.tool.title !== undefined)
                normalizedTool.title = reference.tool.title;
            if (reference.tool.description !== undefined)
                normalizedTool.description = reference.tool.description;
            if (metadata)
                normalizedTool._meta = metadata;
            return {
                serverId: reference.serverId,
                originalName: reference.originalName,
                tool: normalizedTool
            };
        });
        const failedServers = results.filter(result => result.status === "rejected").length;
        diagnostics.end(stage, {
            status: aggregateStatus(results, signal),
            serverCount: results.length,
            failedServers,
            toolCount: normalizedTools.length,
            totalToolSchemaBytes: schemaBytesForTools(
                results
                        .filter((result): result is PromiseFulfilledResult<RemoteTool[]> => result.status === "fulfilled")
                        .flatMap(result => result.value)
            ),
            cacheHits,
            coalescedRequests
        });
        return normalizedTools;
    }

    async callTool(serverId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
        const stage = diagnostics.start("mcp.call_tool");
        const metricId = metricServerId(serverId, stage);
        if (signal?.aborted) {
            diagnostics.end(stage, { status: "aborted", serverId: metricId });
            throw createAbortError();
        }
        const argumentBytes = stage ? diagnostics.jsonBytes(args) : undefined;
        const connection = this.clients.get(serverId);
        if (!connection) {
            diagnostics.end(stage, { status: "error", serverId: metricId, argumentBytes, errorClass: "error" });
            throw new Error(`Server ${serverId} not found`);
        }

        const requestOptions = signal
            ? { timeout: MCP_REQUEST_TIMEOUT_MS, signal }
            : { timeout: MCP_REQUEST_TIMEOUT_MS };
        try {
            const result = await connection.client.callTool({ name: toolName, arguments: args }, undefined, requestOptions);
            const content = (result.content || []) as Array<{ type?: string; text?: string; mimeType?: string }>;
            const output = content.map(item => {
                if (item.type === "text")
                    return item.text || "";
                if (item.type === "image")
                    return `[Image: ${item.mimeType || "unknown"}]`;
                return JSON.stringify(item);
            }).join("\n");
            const truncated = output.length > MAX_TOOL_OUTPUT_LENGTH;
            diagnostics.end(stage, {
                status: "ok",
                serverId: metricId,
                argumentBytes,
                outputBytes: stage ? diagnostics.textBytes(output) : undefined,
                outputTruncated: truncated
            });
            return truncated
                ? `${output.slice(0, MAX_TOOL_OUTPUT_LENGTH)}\n[tool output truncated]`
                : output;
        } catch (error) {
            const errorClass = classifyMcpError(error);
            diagnostics.end(stage, {
                status: errorClass === "aborted" ? "aborted" : errorClass,
                serverId: metricId,
                argumentBytes,
                errorClass
            });
            if (errorClass === "aborted" && !isAbortError(error))
                throw createAbortError();
            throw error;
        }
    }

    async close(): Promise<void> {
        await Promise.allSettled(Array.from(this.clients.values()).map(async connection => {
            await connection.client.close();
            await connection.transport.close();
        }));
        this.clients.clear();
    }

    private async fetchTools(connection: ConnectedClient, force: boolean, signal?: AbortSignal): Promise<RemoteTool[]> {
        if (!force && connection.tools) {
            if (diagnostics.isEnabled()) {
                diagnostics.record("mcp.tool_list", {
                    status: "cache_hit",
                    cache: "hit",
                    serverId: diagnostics.opaqueId(connection.config.id),
                    toolCount: connection.tools.length,
                    toolSchemaBytes: schemaBytesForTools(connection.tools)
                });
            }
            return connection.tools;
        }
        if (!force && connection.toolsPromise) {
            if (diagnostics.isEnabled()) {
                diagnostics.record("mcp.tool_list", {
                    status: "coalesced",
                    cache: "coalesced",
                    serverId: diagnostics.opaqueId(connection.config.id)
                });
            }
            return connection.toolsPromise;
        }

        const stage = diagnostics.start("mcp.tool_list");
        const metricId = metricServerId(connection.config.id, stage);
        const requestOptions = signal
            ? { timeout: MCP_REQUEST_TIMEOUT_MS, signal }
            : { timeout: MCP_REQUEST_TIMEOUT_MS };
        const request = connection.client.listTools({}, requestOptions)
                .then(result => {
                    connection.tools = result.tools as RemoteTool[];
                    diagnostics.end(stage, {
                        status: "ok",
                        cache: "miss",
                        serverId: metricId,
                        toolCount: connection.tools.length,
                        toolSchemaBytes: schemaBytesForTools(connection.tools),
                        forced: force,
                        forcedDiscovery: force ? 1 : undefined
                    });
                    return connection.tools;
                }, error => {
                    const errorClass = classifyMcpError(error);
                    diagnostics.end(stage, {
                        status: errorClass,
                        cache: "miss",
                        serverId: metricId,
                        errorClass,
                        forced: force,
                        forcedDiscovery: force ? 1 : undefined
                    });
                    throw error;
                })
                .finally(() => {
                    if (connection.toolsPromise === request)
                        delete connection.toolsPromise;
                });
        connection.toolsPromise = request;
        return request;
    }
}
