/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ToolPlugin } from "./base.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class SmartPlugin extends ToolPlugin {
    get name(): string {
        return "smart";
    }

    get description(): string {
        return "SMART disk health";
    }

    async detect(): Promise<boolean> {
        try {
            await cockpit.spawn(["which", "smartctl"]);
            return true;
        } catch {
            return false;
        }
    }

    register(server: McpServer): void {
        server.registerTool(
            "smart_health",
            {
                title: "SMART health",
                description: "Check SMART health of a disk",
                inputSchema: z.object({
                    device: z.string().describe("Device path (e.g. /dev/sda)")
                }),
                _meta: { isLowRisk: true },
            },
            async ({ device }) => {
                const result = await this.run(["smartctl", "-H", device]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "smart_run_test",
            {
                title: "SMART test",
                description: "Run SMART test on a disk",
                inputSchema: z.object({
                    device: z.string().describe("Device path (e.g. /dev/sda)"),
                    test: z.enum(["short", "long"]).default("short").describe("Test type")
                })
            },
            async ({ device, test }) => {
                const result = await this.run(["smartctl", "-t", test, device]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );

        server.registerTool(
            "smart_read_test_results",
            {
                title: "SMART test results",
                description: "Read SMART test results from a disk",
                inputSchema: z.object({
                    device: z.string().describe("Device path (e.g. /dev/sda)")
                }),
                _meta: { isLowRisk: true },
            },
            async ({ device }) => {
                const result = await this.run(["smartctl", "-l", "selftest", device]);
                return {
                    content: [{ type: "text", text: result }]
                };
            }
        );
    }

    private async run(cmd: string[]): Promise<string> {
        try {
            return await cockpit.spawn(cmd, { superuser: 'require' });
        } catch (e: any) {
            return `Error running ${cmd[0]}: ${e.message || e.stderr || e}`;
        }
    }
}
