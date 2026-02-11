/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { Tool } from "@modelcontextprotocol/sdk/types.js";

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
     * Return a list of MCP tool definitions provided by this plugin.
     */
    abstract getTools(): Tool[];

    /**
     * Execute a tool provided by this plugin.
     */
    abstract execute(toolName: string, args: Record<string, any>): Promise<any>;
}
