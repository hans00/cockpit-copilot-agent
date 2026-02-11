/* SPDX-License-Identifier: LGPL-2.1-or-later */
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * A transport for in-memory communication between a client and a server.
 * This is useful for running an MCP server directly in the same process/browser window as the client.
 */
export class LocalTransport implements Transport {
    private other?: LocalTransport | undefined;

    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    /**
     * Connect this transport to another LocalTransport.
     */
    connect(other: LocalTransport) {
        this.other = other;
        other.other = this;
    }

    async start(): Promise<void> {
        if (!this.other) {
            throw new Error("LocalTransport must be connected to another LocalTransport before starting");
        }
    }

    async send(message: JSONRPCMessage): Promise<void> {
        if (!this.other) {
            throw new Error("LocalTransport not connected");
        }
        // Send asynchronously to avoid recursive calls and match real transport behavior
        setTimeout(() => {
            if (this.other?.onmessage) {
                this.other.onmessage(message);
            }
        }, 0);
    }

    async close(): Promise<void> {
        if (this.onclose) {
            this.onclose();
        }
        if (this.other) {
            const other = this.other;
            this.other = undefined;
            other.other = undefined;
            if (other.onclose) {
                other.onclose();
            }
        }
    }
}
