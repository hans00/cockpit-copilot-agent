/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export abstract class ToolPlugin {
    /** Name of the plugin (e.g. 'vm', 'container', 'fs') */
    abstract get name(): string;

    /** Brief description of what the plugin provides */
    abstract get description(): string;

    /**
     * Check if the plugin's prerequisites are met on this system.
     * Returns true if the tools should be enabled.
     */
    abstract detect(): Promise<boolean>;

    /**
     * Register tools with the McpServer instance.
     */
    abstract register(server: McpServer): void;
}
