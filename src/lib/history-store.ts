/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ChatMessage, ChatSession, ChatSessionSummary } from "./types.js";
import { DiagnosticFields, diagnostics } from "./diagnostics.js";

const CHUNK_MESSAGE_LIMIT = 32;
const INITIAL_CHUNK_LIMIT = 4;
const INDEX_VERSION = 2;

type StoredMetadata = ChatSessionSummary & {
    messageCount: number;
    chunkCount: number;
};

type ChatState = {
    totalMessages: number;
    loadedFrom: number;
    loadedMessageCount: number;
    persistedChunkCount: number;
};

type HistoryStatus = "not_found" | "parse_error" | "io_error" | "corrupt";
type StorageCategory = "index" | "metadata" | "chunk" | "legacy";
type HistoryError = Error & { historyStatus?: HistoryStatus };

const createHistoryError = (status: HistoryStatus, message: string): HistoryError =>
    Object.assign(new Error(message), { historyStatus: status });

const classifyHistoryError = (error: unknown, fallback: HistoryStatus = "io_error"): HistoryStatus => {
    if (typeof error === "object" && error !== null && "historyStatus" in error) {
        const status = error.historyStatus;
        if (status === "not_found" || status === "parse_error" || status === "io_error" || status === "corrupt")
            return status;
    }
    if (error instanceof SyntaxError)
        return "parse_error";

    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file|not found|does not exist/i.test(message))
        return "not_found";
    return fallback;
};

const isStoredMetadata = (value: unknown): value is StoredMetadata => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const metadata = value as Partial<StoredMetadata>;
    return typeof metadata.id === "string" &&
        typeof metadata.title === "string" &&
        typeof metadata.lastModified === "number" && Number.isFinite(metadata.lastModified) &&
        typeof metadata.messageCount === "number" && Number.isSafeInteger(metadata.messageCount) && metadata.messageCount >= 0 &&
        typeof metadata.chunkCount === "number" && Number.isSafeInteger(metadata.chunkCount) && metadata.chunkCount >= 0;
};

const isSafeChatId = (id: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(id);

/**
 * Keeps the chat index small and writes message data in bounded chunks.
 * The index is intentionally user-local; settings and credentials remain
 * system-wide in their respective /etc/cockpit files.
 */
export class HistoryStore {
    private readonly historyDir: string;
    private readonly indexPath: string;
    private readonly legacyPath: string;
    private summaries: Record<string, ChatSessionSummary> = {};
    private states = new Map<string, ChatState>();
    private writeQueues = new Map<string, Promise<void>>();
    private queueDepths = new Map<string, number>();
    private indexDirty = false;
    private indexTimer: ReturnType<typeof setTimeout> | undefined;
    private indexWrite: Promise<void> = Promise.resolve();

    constructor(private readonly home: string = cockpit.info.user.home) {
        this.historyDir = `${home}/.local/share/cockpit/copilot-chats`;
        this.indexPath = `${this.historyDir}/index.json`;
        this.legacyPath = `${home}/.local/share/cockpit/copilot-history.json`;
    }

    async initialize(): Promise<Record<string, ChatSessionSummary>> {
        const stage = diagnostics.start("history.initialize");
        try {
            await cockpit.spawn(["mkdir", "-p", this.historyDir]);

            let indexFound = false;
            let status: "ok" | HistoryStatus = "ok";
            try {
                const parsed = await this.readJson(this.indexPath, "index");
                indexFound = true;
                const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? parsed as Record<string, unknown>
                    : undefined;
                if (record?.version === INDEX_VERSION && record.chats && typeof record.chats === "object") {
                    this.summaries = record.chats as Record<string, ChatSessionSummary>;
                } else if (record) {
                    // Read the pre-chunked index format for an in-place upgrade.
                    const entries = Object.entries(record).filter(([, value]) =>
                        value && typeof value === "object" && "id" in value && "lastModified" in value
                    );
                    if (Object.keys(record).length > 0 && entries.length === 0) {
                        this.summaries = {};
                        status = "corrupt";
                    } else {
                        this.summaries = Object.fromEntries(entries) as Record<string, ChatSessionSummary>;
                    }
                } else {
                    this.summaries = {};
                    status = "corrupt";
                }
            } catch (error) {
                this.summaries = {};
                status = classifyHistoryError(error);
            }

            diagnostics.end(stage, {
                status: indexFound ? status : status === "ok" ? "not_found" : status,
                indexFound,
                chatCount: Object.keys(this.summaries).length
            });
            return { ...this.summaries };
        } catch (error) {
            diagnostics.end(stage, { status: classifyHistoryError(error) });
            throw error;
        }
    }

    getHistory(): ChatSessionSummary[] {
        return Object.values(this.summaries).sort((a, b) => b.lastModified - a.lastModified);
    }

    async loadChat(id: string): Promise<ChatSession | null> {
        if (!isSafeChatId(id))
            return null;

        const stage = diagnostics.start("history.load");
        let ended = false;
        const finish = (fields: DiagnosticFields): void => {
            if (!ended) {
                ended = true;
                diagnostics.end(stage, fields);
            }
        };

        try {
            let chunkError: unknown;
            try {
                const metadataValue = await this.readJson(`${this.historyDir}/${id}/meta.json`, "metadata");
                if (!isStoredMetadata(metadataValue) || metadataValue.id !== id)
                    throw createHistoryError("corrupt", "Invalid chat metadata");
                const metadata = metadataValue;
                const minimumChunkCount = metadata.messageCount === 0
                    ? 0
                    : Math.ceil(metadata.messageCount / CHUNK_MESSAGE_LIMIT);
                if (metadata.chunkCount < minimumChunkCount)
                    throw createHistoryError("corrupt", "Chat metadata has too few chunks");

                const chunkCount = metadata.chunkCount;
                const firstChunk = Math.max(0, chunkCount - INITIAL_CHUNK_LIMIT);
                const chunks = await Promise.all(
                    Array.from({ length: chunkCount - firstChunk }, (_, offset) =>
                        this.readJson(
                            `${this.historyDir}/${id}/chunks/${String(firstChunk + offset).padStart(8, "0")}.json`,
                            "chunk"
                        )
                    )
                );
                if (chunks.some(chunk => !Array.isArray(chunk)))
                    throw createHistoryError("corrupt", "Invalid chat history chunk");
                const messages = chunks.flatMap(chunk => chunk as ChatMessage[]);
                if (messages.length > metadata.messageCount)
                    throw createHistoryError("corrupt", "Chat history exceeds metadata count");

                this.states.set(id, {
                    totalMessages: metadata.messageCount,
                    loadedFrom: firstChunk * CHUNK_MESSAGE_LIMIT,
                    loadedMessageCount: messages.length,
                    persistedChunkCount: chunkCount
                });

                const session = {
                    id: metadata.id,
                    title: metadata.title,
                    messages,
                    lastModified: metadata.lastModified,
                    messageCount: metadata.messageCount,
                    loadedMessageCount: messages.length
                };
                finish({
                    status: "ok",
                    format: "chunked",
                    storageCategory: "chunk",
                    chunkCount,
                    persistedChunkCount: chunkCount,
                    totalMessageCount: metadata.messageCount,
                    loadedMessageCount: messages.length
                });
                return session;
            } catch (error) {
                chunkError = error;
            }

            // Fall back to the previous one-file-per-chat format.
            try {
                const session = await this.readJson(`${this.historyDir}/${id}.json`, "legacy") as ChatSession;
                if (!session || session.id !== id || !Array.isArray(session.messages) ||
                    typeof session.title !== "string" || typeof session.lastModified !== "number" ||
                    !Number.isFinite(session.lastModified))
                    throw createHistoryError("corrupt", "Invalid legacy chat history");
                const chunkCount = Math.max(1, Math.ceil(session.messages.length / CHUNK_MESSAGE_LIMIT));
                this.states.set(id, {
                    totalMessages: session.messages.length,
                    loadedFrom: 0,
                    loadedMessageCount: session.messages.length,
                    persistedChunkCount: chunkCount
                });
                const sessionWithMetadata = {
                    ...session,
                    messageCount: session.messages.length,
                    loadedMessageCount: session.messages.length
                };
                finish({
                    status: "ok",
                    format: "legacy",
                    storageCategory: "legacy",
                    chunkCount,
                    totalMessageCount: session.messages.length,
                    loadedMessageCount: session.messages.length
                });
                return sessionWithMetadata;
            } catch (legacyError) {
                const chunkStatus = classifyHistoryError(chunkError);
                const legacyStatus = classifyHistoryError(legacyError);
                finish({
                    status: legacyStatus === "not_found" ? chunkStatus : legacyStatus,
                    storageCategory: legacyStatus === "not_found" ? "chunk" : "legacy"
                });
                return null;
            }
        } finally {
            if (!ended)
                finish({ status: "io_error" });
        }
    }

    async saveChat(session: ChatSession): Promise<void> {
        if (!isSafeChatId(session.id))
            throw new Error("Invalid chat id");

        const stage = diagnostics.start("history.save");
        let queueDepth: number | undefined;
        let queueWaitMs: number | undefined;
        let totalMessageCount = session.messages.length;
        let chunkCount = 0;
        try {
            await this.enqueue(session.id, async () => {
                const previous = this.states.get(session.id);
                const loadedCount = session.loadedMessageCount ?? session.messages.length;
                const totalBefore = previous?.totalMessages ?? loadedCount;
                const appendOnly = !!previous && loadedCount >= previous.loadedMessageCount;
                const addedMessages = Math.max(0, session.messages.length - loadedCount);
                const totalMessages = appendOnly ? totalBefore + addedMessages : session.messages.length;
                const firstChunk = appendOnly && previous
                    ? previous.loadedFrom / CHUNK_MESSAGE_LIMIT
                    : 0;
                const firstChangedChunk = appendOnly && previous
                    ? firstChunk + Math.floor(previous.loadedMessageCount / CHUNK_MESSAGE_LIMIT)
                    : 0;
                const allChunks = Math.max(1, Math.ceil(totalMessages / CHUNK_MESSAGE_LIMIT));
                totalMessageCount = totalMessages;
                chunkCount = allChunks;

                await cockpit.spawn(["mkdir", "-p", `${this.historyDir}/${session.id}/chunks`]);

                for (let chunk = appendOnly ? firstChangedChunk : 0; chunk < allChunks; chunk++) {
                    const start = appendOnly
                        ? (chunk - firstChunk) * CHUNK_MESSAGE_LIMIT
                        : chunk * CHUNK_MESSAGE_LIMIT;
                    const content = session.messages.slice(start, start + CHUNK_MESSAGE_LIMIT);
                    // In append-only mode, the loaded window starts at firstChunk.
                    // Older chunks are already persisted and are deliberately untouched.
                    if (content.length > 0 || chunk === 0) {
                        await this.writeJson(
                            `${this.historyDir}/${session.id}/chunks/${String(chunk).padStart(8, "0")}.json`,
                            content,
                            "chunk"
                        );
                    }
                }

                const metadata: StoredMetadata = {
                    id: session.id,
                    title: session.title,
                    lastModified: session.lastModified,
                    messageCount: totalMessages,
                    chunkCount: allChunks
                };
                await this.writeJson(`${this.historyDir}/${session.id}/meta.json`, metadata, "metadata");

                this.states.set(session.id, {
                    totalMessages,
                    loadedFrom: appendOnly ? previous.loadedFrom : 0,
                    loadedMessageCount: session.messages.length,
                    persistedChunkCount: allChunks
                });
                this.summaries[session.id] = {
                    id: session.id,
                    title: session.title,
                    lastModified: session.lastModified,
                    messageCount: totalMessages
                };
                this.markIndexDirty();
            }, (depth, waitMs) => {
                queueDepth = depth;
                queueWaitMs = waitMs;
            });
            diagnostics.end(stage, {
                status: "ok",
                storageCategory: "chunk",
                chunkCount,
                totalMessageCount,
                loadedMessageCount: session.messages.length,
                queueDepth,
                queueWaitMs
            });
        } catch (error) {
            diagnostics.end(stage, {
                status: classifyHistoryError(error),
                storageCategory: "chunk",
                chunkCount: chunkCount || undefined,
                totalMessageCount,
                loadedMessageCount: session.messages.length,
                queueDepth,
                queueWaitMs
            });
            throw error;
        }
    }

    async deleteChat(id: string): Promise<void> {
        if (!isSafeChatId(id))
            return;

        const stage = diagnostics.start("history.delete");
        try {
            await this.enqueue(id, async () => {
                delete this.summaries[id];
                this.states.delete(id);
                this.markIndexDirty();
                await cockpit.spawn(["rm", "-rf", `${this.historyDir}/${id}`, `${this.historyDir}/${id}.json`]);
            }, undefined);
            diagnostics.end(stage, { status: "ok" });
        } catch (error) {
            diagnostics.end(stage, { status: "error" });
            throw error;
        }
    }

    async migrateLegacy(): Promise<ChatSession[]> {
        const stage = diagnostics.start("history.migration");
        let content: string | null;
        try {
            content = await this.readFile(this.legacyPath, "legacy");
        } catch (error) {
            diagnostics.end(stage, { status: classifyHistoryError(error), storageCategory: "legacy" });
            return [];
        }
        if (!content) {
            diagnostics.end(stage, {
                status: "empty",
                storageCategory: "legacy",
                legacyBytes: stage ? diagnostics.textBytes(content) : undefined
            });
            return [];
        }

        try {
            const oldHistory = JSON.parse(content) as Record<string, ChatSession>;
            const sessions = Object.values(oldHistory).filter(session => isSafeChatId(session.id));
            for (const session of sessions)
                await this.saveChat({ ...session, loadedMessageCount: session.messages.length });
            await this.flush();
            await cockpit.spawn(["mv", this.legacyPath, `${this.legacyPath}.bak`]);
            diagnostics.end(stage, {
                status: "ok",
                storageCategory: "legacy",
                legacyBytes: stage ? diagnostics.textBytes(content) : undefined,
                sessionCount: sessions.length
            });
            return sessions;
        } catch (error) {
            diagnostics.end(stage, {
                status: classifyHistoryError(error, "parse_error"),
                storageCategory: "legacy",
                legacyBytes: stage ? diagnostics.textBytes(content) : undefined
            });
            console.error("Failed to migrate chat history:", error);
            return [];
        }
    }

    async flush(): Promise<void> {
        const stage = diagnostics.start("history.flush");
        const queuedWrites = this.writeQueues.size;
        const queueDepth = diagnostics.isEnabled()
            ? Array.from(this.queueDepths.values()).reduce((sum, depth) => sum + depth, 0)
            : undefined;
        if (this.indexTimer) {
            clearTimeout(this.indexTimer);
            this.indexTimer = undefined;
        }

        try {
            await Promise.all(this.writeQueues.values());
            if (this.indexDirty) {
                this.indexDirty = false;
                this.indexWrite = this.indexWrite.then(() =>
                    this.writeJson(this.indexPath, { version: INDEX_VERSION, chats: this.summaries }, "index")
                );
            }
            await this.indexWrite;
            diagnostics.end(stage, { status: "ok", queuedWrites, queueDepth });
        } catch (error) {
            diagnostics.end(stage, { status: classifyHistoryError(error), queuedWrites, queueDepth });
            throw error;
        }
    }

    private markIndexDirty(): void {
        this.indexDirty = true;
        if (!this.indexTimer) {
            this.indexTimer = setTimeout(() => {
                this.indexTimer = undefined;
                this.flush().catch(error => {
                    this.indexDirty = true;
                    console.error("Failed to save chat index:", error);
                });
            }, 500);
        }
    }

    private enqueue(
        id: string,
        operation: () => Promise<void>,
        onStart?: (depth: number, waitMs: number) => void
    ): Promise<void> {
        const previous = this.writeQueues.get(id) || Promise.resolve();
        const metricsEnabled = diagnostics.isEnabled();
        const queuedAt = metricsEnabled ? Date.now() : 0;
        const depth = metricsEnabled ? (this.queueDepths.get(id) || 0) + 1 : 0;
        if (metricsEnabled)
            this.queueDepths.set(id, depth);
        const next = previous.catch(() => undefined).then(async () => {
            if (metricsEnabled)
                onStart?.(depth, Math.max(0, Date.now() - queuedAt));
            await operation();
        });
        this.writeQueues.set(id, next);
        return next.finally(() => {
            if (this.writeQueues.get(id) === next)
                this.writeQueues.delete(id);
            if (metricsEnabled) {
                const remaining = (this.queueDepths.get(id) || 1) - 1;
                if (remaining > 0)
                    this.queueDepths.set(id, remaining);
                else
                    this.queueDepths.delete(id);
            }
        });
    }

    private async readJson(path: string, category: StorageCategory): Promise<unknown> {
        return this.readWithMetrics(path, category, content => JSON.parse(content));
    }

    private async readFile(path: string, category: StorageCategory): Promise<string> {
        return this.readWithMetrics(path, category, content => content);
    }

    private async readWithMetrics<T>(
        path: string,
        category: StorageCategory,
        parse: (content: string) => T
    ): Promise<T> {
        const file = cockpit.file(path);
        const stage = diagnostics.start("history.read");
        let ended = false;
        const finish = (fields: DiagnosticFields): void => {
            if (!ended) {
                ended = true;
                diagnostics.end(stage, fields);
            }
        };

        try {
            const content = await file.read();
            try {
                const value = parse(content);
                finish({
                    status: "ok",
                    storageCategory: category,
                    bytes: stage ? diagnostics.textBytes(content) : undefined
                });
                return value;
            } catch (error) {
                finish({
                    status: classifyHistoryError(error, "parse_error"),
                    storageCategory: category,
                    bytes: stage ? diagnostics.textBytes(content) : undefined
                });
                throw error;
            }
        } catch (error) {
            finish({ status: classifyHistoryError(error), storageCategory: category });
            throw error;
        } finally {
            try {
                file.close();
            } catch {
                // Closing a Cockpit file handle must not replace the read result.
            }
        }
    }

    private async writeJson(path: string, value: unknown, category: StorageCategory): Promise<void> {
        const file = cockpit.file(path);
        const stage = diagnostics.start("history.write");
        try {
            const content = JSON.stringify(value);
            if (content === undefined)
                throw createHistoryError("corrupt", "History value is not serializable");
            await file.replace(content);
            diagnostics.end(stage, {
                status: "ok",
                storageCategory: category,
                bytes: stage ? diagnostics.textBytes(content) : undefined
            });
        } catch (error) {
            diagnostics.end(stage, {
                status: classifyHistoryError(error),
                storageCategory: category
            });
            throw error;
        } finally {
            try {
                file.close();
            } catch {
                // Closing a Cockpit file handle must not replace the write result.
            }
        }
    }
}
