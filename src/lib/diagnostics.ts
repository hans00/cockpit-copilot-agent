/* SPDX-License-Identifier: LGPL-2.1-or-later */

const MAX_RECORDS = 256;
const DIAGNOSTICS_FLAG = "__COCKPIT_COPILOT_AGENT_DIAGNOSTICS__";

type DiagnosticsGlobal = typeof globalThis & {
    [DIAGNOSTICS_FLAG]?: boolean;
};

export type DiagnosticValue = string | number | boolean;
export type DiagnosticFields = Record<string, DiagnosticValue | undefined>;

export interface DiagnosticRecord {
    name: string;
    timestamp: number;
    durationMs?: number;
    fields?: DiagnosticFields;
}

export interface DiagnosticSpan {
    name: string;
    startedAt: number;
}

const KNOWN_EVENTS = new Set([
    "startup.total",
    "startup.cockpit_ready",
    "startup.settings_credentials",
    "startup.agent_init",
    "startup.agent_ready",
    "startup.chat_mounted",
    "startup.chat_ready",
    "startup.input_ready",
    "startup.history_restore",
    "startup.mcp_setup",
    "startup.builtin_mcp",
    "startup.optional_plugins",
    "startup.custom_mcp",
    "startup.system_context",
    "startup.ready",
    "history.initialize",
    "history.load",
    "history.save",
    "history.delete",
    "history.migration",
    "history.flush",
    "history.read",
    "history.write",
    "mcp.connect",
    "mcp.refresh_tools",
    "mcp.list_tools",
    "mcp.tool_list",
    "mcp.call_tool",
    "llm.request",
    "llm.first_response",
    "llm.first_text",
    "llm.first_tool_call"
]);

const ALLOWED_FIELDS = new Set([
    "status",
    "transport",
    "model",
    "messageCount",
    "chatCount",
    "indexFound",
    "format",
    "chunkCount",
    "persistedChunkCount",
    "totalMessageCount",
    "loadedMessageCount",
    "legacyBytes",
    "sessionCount",
    "queuedWrites",
    "queueDepth",
    "queueWaitMs",
    "storageCategory",
    "bytes",
    "readBytes",
    "writeBytes",
    "serverCount",
    "failedServers",
    "toolCount",
    "argumentBytes",
    "outputBytes",
    "outputTruncated",
    "toolSchemaBytes",
    "totalToolSchemaBytes",
    "serverId",
    "forced",
    "cache",
    "cacheHits",
    "coalescedRequests",
    "forcedDiscovery",
    "errorClass",
    "timeoutMs",
    "logicalRequestBytes",
    "logicalResponseBytes",
    "responseToolCallCount",
    "responseEvent",
    "firstResponseBytes",
    "firstTextBytes",
    "firstToolCallBytes",
    "hostExitStatus",
    "attempt"
]);

const MAX_FIELD_STRING_LENGTH = 256;

const enabled = (() => {
    try {
        const scope = globalThis as DiagnosticsGlobal;
        if (scope[DIAGNOSTICS_FLAG] === true)
            return true;
        return scope.location?.search
            ? new URLSearchParams(scope.location.search).get("diagnostics") === "1"
            : false;
    } catch {
        return false;
    }
})();

const records: DiagnosticRecord[] = [];

const now = (): number => typeof performance !== "undefined" ? performance.now() : Date.now();

const redactString = (value: string): string => value
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/\b(?:sk|key|token|secret)[-_A-Za-z0-9]*\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
        .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, "[redacted]@")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");

const addRecord = (record: DiagnosticRecord): void => {
    if (!enabled)
        return;
    if (records.length >= MAX_RECORDS)
        records.shift();
    records.push(record);
    console.debug(`[cockpit-copilot-agent] ${record.name}`, record);
};

const cleanFields = (fields?: DiagnosticFields): DiagnosticFields | undefined => {
    if (!fields)
        return undefined;
    const cleaned: DiagnosticFields = {};
    for (const [key, value] of Object.entries(fields)) {
        if (!ALLOWED_FIELDS.has(key) || value === undefined)
            continue;
        if (typeof value === "string") {
            cleaned[key] = redactString(value.slice(0, MAX_FIELD_STRING_LENGTH));
        } else if (typeof value === "number") {
            if (Number.isFinite(value))
                cleaned[key] = value;
        } else if (typeof value === "boolean") {
            cleaned[key] = value;
        }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

export const diagnostics = {
    enabled,

    isEnabled(): boolean {
        return enabled;
    },

    opaqueId(value: string): string {
        let first = 2166136261;
        let second = 16777619;
        for (const character of value) {
            first ^= character.charCodeAt(0);
            first = Math.imul(first, 16777619);
            second ^= character.charCodeAt(0) + 31;
            second = Math.imul(second, 16777619);
        }
        return `id_${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
    },

    start(name: string): DiagnosticSpan | null {
        if (!enabled || !KNOWN_EVENTS.has(name))
            return null;
        return { name, startedAt: now() };
    },

    end(span: DiagnosticSpan | null, fields?: DiagnosticFields): void {
        if (!span)
            return;
        const record: DiagnosticRecord = {
            name: span.name,
            timestamp: Date.now(),
            durationMs: Math.round(Math.max(0, now() - span.startedAt))
        };
        const cleaned = cleanFields(fields);
        if (cleaned)
            record.fields = cleaned;
        addRecord(record);
    },

    record(name: string, fields?: DiagnosticFields): void {
        if (!enabled || !KNOWN_EVENTS.has(name))
            return;
        const record: DiagnosticRecord = {
            name,
            timestamp: Date.now()
        };
        const cleaned = cleanFields(fields);
        if (cleaned)
            record.fields = cleaned;
        addRecord(record);
    },

    textBytes(value: string): number {
        if (!enabled)
            return 0;
        try {
            return new TextEncoder().encode(value).byteLength;
        } catch {
            return value.length;
        }
    },

    jsonBytes(value: unknown): number {
        if (!enabled)
            return 0;
        try {
            return this.textBytes(JSON.stringify(value));
        } catch {
            return 0;
        }
    },

    getRecords(): readonly DiagnosticRecord[] {
        return enabled ? records.slice() : [];
    },

    clear(): void {
        if (enabled)
            records.length = 0;
    }
};
