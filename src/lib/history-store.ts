/* SPDX-License-Identifier: LGPL-2.1-or-later */
import cockpit from "cockpit";
import { ChatMessage, ChatSession, ChatSessionSummary } from "./types.js";

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
    private indexDirty = false;
    private indexTimer: ReturnType<typeof setTimeout> | undefined;
    private indexWrite: Promise<void> = Promise.resolve();

    constructor(private readonly home: string = cockpit.info.user.home) {
        this.historyDir = `${home}/.local/share/cockpit/copilot-chats`;
        this.indexPath = `${this.historyDir}/index.json`;
        this.legacyPath = `${home}/.local/share/cockpit/copilot-history.json`;
    }

    async initialize(): Promise<Record<string, ChatSessionSummary>> {
        await cockpit.spawn(["mkdir", "-p", this.historyDir]);

        try {
            const parsed = await this.readJson(this.indexPath);
            const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : undefined;
            if (record?.version === INDEX_VERSION && record.chats && typeof record.chats === "object") {
                this.summaries = record.chats as Record<string, ChatSessionSummary>;
            } else if (record) {
                // Read the pre-chunked index format for an in-place upgrade.
                this.summaries = Object.fromEntries(
                    Object.entries(record).filter(([, value]) =>
                        value && typeof value === "object" && "id" in value && "lastModified" in value
                    )
                ) as Record<string, ChatSessionSummary>;
            }
        } catch {
            this.summaries = {};
        }

        return { ...this.summaries };
    }

    getHistory(): ChatSessionSummary[] {
        return Object.values(this.summaries).sort((a, b) => b.lastModified - a.lastModified);
    }

    async loadChat(id: string): Promise<ChatSession | null> {
        if (!isSafeChatId(id))
            return null;

        try {
            const metadata = await this.readJson(`${this.historyDir}/${id}/meta.json`) as StoredMetadata;
            const chunkCount = Math.max(0, metadata.chunkCount || 0);
            const firstChunk = Math.max(0, chunkCount - INITIAL_CHUNK_LIMIT);
            const chunks = await Promise.all(
                Array.from({ length: chunkCount - firstChunk }, (_, offset) =>
                    this.readJson(`${this.historyDir}/${id}/chunks/${String(firstChunk + offset).padStart(8, "0")}.json`)
                )
            );
            const messages = chunks.flatMap(chunk => Array.isArray(chunk) ? chunk as ChatMessage[] : []);

            this.states.set(id, {
                totalMessages: metadata.messageCount,
                loadedFrom: firstChunk * CHUNK_MESSAGE_LIMIT,
                loadedMessageCount: messages.length,
                persistedChunkCount: chunkCount
            });

            return {
                id: metadata.id,
                title: metadata.title,
                messages,
                lastModified: metadata.lastModified,
                messageCount: metadata.messageCount,
                loadedMessageCount: messages.length
            };
        } catch {
            // Fall back to the previous one-file-per-chat format.
            try {
                const session = await this.readJson(`${this.historyDir}/${id}.json`) as ChatSession;
                if (!session || !Array.isArray(session.messages))
                    return null;
                this.states.set(id, {
                    totalMessages: session.messages.length,
                    loadedFrom: 0,
                    loadedMessageCount: session.messages.length,
                    persistedChunkCount: Math.ceil(session.messages.length / CHUNK_MESSAGE_LIMIT)
                });
                return {
                    ...session,
                    messageCount: session.messages.length,
                    loadedMessageCount: session.messages.length
                };
            } catch {
                return null;
            }
        }
    }

    async saveChat(session: ChatSession): Promise<void> {
        if (!isSafeChatId(session.id))
            throw new Error("Invalid chat id");

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
                        content
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
            await this.writeJson(`${this.historyDir}/${session.id}/meta.json`, metadata);

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
        });
    }

    async deleteChat(id: string): Promise<void> {
        if (!isSafeChatId(id))
            return;

        await this.enqueue(id, async () => {
            delete this.summaries[id];
            this.states.delete(id);
            this.markIndexDirty();
            await cockpit.spawn(["rm", "-rf", `${this.historyDir}/${id}`, `${this.historyDir}/${id}.json`]);
        });
    }

    async migrateLegacy(): Promise<ChatSession[]> {
        let content: string | null;
        try {
            content = await this.readFile(this.legacyPath);
        } catch {
            return [];
        }
        if (!content)
            return [];

        try {
            const oldHistory = JSON.parse(content) as Record<string, ChatSession>;
            const sessions = Object.values(oldHistory).filter(session => isSafeChatId(session.id));
            for (const session of sessions)
                await this.saveChat({ ...session, loadedMessageCount: session.messages.length });
            await this.flush();
            await cockpit.spawn(["mv", this.legacyPath, `${this.legacyPath}.bak`]);
            return sessions;
        } catch (error) {
            console.error("Failed to migrate chat history:", error);
            return [];
        }
    }

    async flush(): Promise<void> {
        if (this.indexTimer) {
            clearTimeout(this.indexTimer);
            this.indexTimer = undefined;
        }

        await Promise.all(this.writeQueues.values());
        if (this.indexDirty) {
            this.indexDirty = false;
            this.indexWrite = this.indexWrite.then(() =>
                this.writeJson(this.indexPath, { version: INDEX_VERSION, chats: this.summaries })
            );
        }
        await this.indexWrite;
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

    private enqueue(id: string, operation: () => Promise<void>): Promise<void> {
        const previous = this.writeQueues.get(id) || Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        this.writeQueues.set(id, next);
        return next.finally(() => {
            if (this.writeQueues.get(id) === next)
                this.writeQueues.delete(id);
        });
    }

    private async readJson(path: string): Promise<unknown> {
        const content = await this.readFile(path);
        return JSON.parse(content);
    }

    private async readFile(path: string): Promise<string> {
        const file = cockpit.file(path);
        try {
            return await file.read();
        } finally {
            file.close();
        }
    }

    private async writeJson(path: string, value: unknown): Promise<void> {
        const file = cockpit.file(path);
        try {
            await file.replace(JSON.stringify(value));
        } finally {
            file.close();
        }
    }
}
