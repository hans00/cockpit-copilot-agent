#!/usr/bin/env node

import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const cockpitStub = `
export default globalThis.__phase0Cockpit;
`;

const slowLlmStub = `
const state = {
    createCalls: 0,
    aborted: false,
    signal: undefined,
    rejectPending: undefined
};

const makeAbortError = () => {
    const error = new Error("Request aborted");
    error.name = "AbortError";
    return error;
};

class SlowOpenAI {
    constructor() {
        this.chat = {
            completions: {
                create: async (_request, options = {}) => {
                    state.createCalls++;
                    state.signal = options.signal;
                    let step = 0;
                    let removeAbortListener = () => {};
                    const abort = () => {
                        state.aborted = true;
                        state.rejectPending?.(makeAbortError());
                    };

                    options.signal?.addEventListener("abort", abort, { once: true });
                    removeAbortListener = () => options.signal?.removeEventListener("abort", abort);

                    return {
                        [Symbol.asyncIterator]() {
                            return {
                                next() {
                                    if (step++ === 0) {
                                        return Promise.resolve({
                                            done: false,
                                            value: { choices: [{ delta: { content: "slow-prefix" } }] }
                                        });
                                    }

                                    if (options.signal?.aborted)
                                        return Promise.reject(makeAbortError());

                                    return new Promise((_resolve, reject) => {
                                        state.rejectPending = reject;
                                    });
                                },
                                return() {
                                    removeAbortListener();
                                    return Promise.resolve({ done: true, value: undefined });
                                }
                            };
                        }
                    };
                }
            }
        };
    }
}

globalThis.__phase0SlowLlmState = state;
export default SlowOpenAI;
`;

let sourceModuleCounter = 0;

const sourceModule = async (entryPoint, { openai = undefined } = {}) => {
    const result = await build({
        absWorkingDir: ROOT,
        bundle: true,
        entryPoints: [entryPoint],
        format: "esm",
        legalComments: "none",
        platform: "node",
        resolveExtensions: [".ts", ".tsx", ".js"],
        target: "es2020",
        write: false,
        plugins: [{
            name: "phase0-module-doubles",
            setup(buildContext) {
                buildContext.onResolve({ filter: /^cockpit$/ }, args => ({
                    namespace: "phase0-cockpit",
                    path: args.path
                }));
                buildContext.onLoad({ filter: /^cockpit$/, namespace: "phase0-cockpit" }, () => ({
                    contents: cockpitStub,
                    loader: "js"
                }));

                if (openai !== undefined) {
                    buildContext.onResolve({ filter: /^openai$/ }, args => ({
                        namespace: "phase0-openai",
                        path: args.path
                    }));
                    buildContext.onLoad({ filter: /^openai$/, namespace: "phase0-openai" }, () => ({
                        contents: openai,
                        loader: "js"
                    }));
                }
            }
        }]
    });

    const bundled = result.outputFiles[0].text;
    sourceModuleCounter++;
    return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}#phase0-${sourceModuleCounter}`);
};

const createCockpitFileSystem = () => {
    const files = new Map();
    const directories = new Set();
    const replacePaths = [];
    const replaceRecords = [];
    const readPaths = [];
    const readRecords = [];
    const spawned = [];
    const pendingFailures = new Set();
    let openedHandles = 0;
    let closedHandles = 0;

    const normalize = filePath => path.posix.normalize(filePath);
    const isBelow = (filePath, directory) => filePath === directory || filePath.startsWith(`${directory}/`);

    const cockpit = {
        info: {
            user: {
                home: "/home/phase0",
                name: "phase0",
                uid: 1000,
                groups: ["phase0"],
            }
        },
        file(filePath) {
            const normalizedPath = normalize(filePath);
            let closed = false;
            openedHandles++;
            return {
                async read() {
                    readPaths.push(normalizedPath);
                    if (!files.has(normalizedPath))
                        throw new Error(`ENOENT: ${normalizedPath}`);
                    const content = files.get(normalizedPath);
                    readRecords.push({
                        path: normalizedPath,
                        bytes: Buffer.byteLength(content)
                    });
                    return content;
                },
                async replace(content) {
                    replacePaths.push(normalizedPath);
                    replaceRecords.push({
                        path: normalizedPath,
                        bytes: Buffer.byteLength(content)
                    });
                    if (pendingFailures.delete(normalizedPath))
                        throw new Error(`interrupted replace: ${normalizedPath}`);
                    files.set(normalizedPath, content);
                },
                close() {
                    if (!closed) {
                        closed = true;
                        closedHandles++;
                    }
                }
            };
        },
        spawn(argv) {
            spawned.push([...argv]);
            const [command, ...args] = argv;
            if (command === "mkdir" && args[0] === "-p") {
                directories.add(normalize(args[1]));
                return Promise.resolve("");
            }
            if (command === "rm" && args[0] === "-rf") {
                for (const target of args.slice(1).map(normalize)) {
                    for (const filePath of files.keys()) {
                        if (isBelow(filePath, target))
                            files.delete(filePath);
                    }
                }
                return Promise.resolve("");
            }
            if (command === "mv") {
                const source = normalize(args[0]);
                const destination = normalize(args[1]);
                if (!files.has(source))
                    throw new Error(`ENOENT: ${source}`);
                files.set(destination, files.get(source));
                files.delete(source);
                return Promise.resolve("");
            }
            if (command === "chmod")
                return Promise.resolve("");
            throw new Error(`Unexpected cockpit.spawn: ${argv.join(" ")}`);
        },
    };

    return {
        cockpit,
        files,
        directories,
        replacePaths,
        replaceRecords,
        readPaths,
        readRecords,
        spawned,
        openedHandles: () => openedHandles,
        closedHandles: () => closedHandles,
        failBeforeReplace(filePath) {
            pendingFailures.add(normalize(filePath));
        },
        contents(filePath) {
            return files.get(normalize(filePath));
        },
        pathsUnder(directory) {
            const normalizedDirectory = normalize(directory);
            return [...files.keys()].filter(filePath => isBelow(filePath, normalizedDirectory));
        }
    };
};

const historyRoot = home => `${home}/.local/share/cockpit/copilot-chats`;
const chunkPath = (home, chatId, chunk) =>
    `${historyRoot(home)}/${chatId}/chunks/${String(chunk).padStart(8, "0")}.json`;
const metadataPath = (home, chatId) => `${historyRoot(home)}/${chatId}/meta.json`;

const message = index => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `deterministic message ${index}`
});

const withMutedConsole = async (callback) => {
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
        return await callback();
    } finally {
        console.error = originalError;
        console.warn = originalWarn;
    }
};

const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test("HistoryStore bounds long history loads and append transfer size", async () => {
    const fs = createCockpitFileSystem();
    globalThis.__phase0Cockpit = fs.cockpit;
    const { HistoryStore } = await sourceModule("./src/lib/history-store.ts");
    const home = "/home/phase0";
    const chatId = "long-history";
    const initialMessages = Array.from({ length: 160 }, (_, index) => message(index));
    const store = new HistoryStore(home);

    await store.initialize();
    await store.saveChat({
        id: chatId,
        title: "Long history",
        messages: initialMessages,
        lastModified: 1,
        loadedMessageCount: initialMessages.length
    });
    await store.flush();

    const readStart = fs.readRecords.length;
    const loaded = await store.loadChat(chatId);
    assert.ok(loaded);
    const initialLoadReads = fs.readRecords.slice(readStart);
    const expectedInitialLoadPaths = [
        metadataPath(home, chatId),
        ...Array.from({ length: 4 }, (_, offset) => chunkPath(home, chatId, offset + 1))
    ];
    assert.equal(initialLoadReads.length, expectedInitialLoadPaths.length,
        "long-history load must read metadata plus only the bounded tail chunks");
    assert.deepEqual(initialLoadReads.map(read => read.path), expectedInitialLoadPaths);
    const initialLoadBytes = initialLoadReads.reduce((total, read) => total + read.bytes, 0);
    const expectedInitialLoadBytes = expectedInitialLoadPaths
            .reduce((total, filePath) => total + Buffer.byteLength(fs.contents(filePath)), 0);
    assert.equal(initialLoadBytes, expectedInitialLoadBytes,
        "bounded-load byte proxy must include only the metadata and tail chunks");
    const allChunkBytes = fs.pathsUnder(`${historyRoot(home)}/${chatId}/chunks`)
            .reduce((total, filePath) => total + Buffer.byteLength(fs.contents(filePath)), 0);
    assert.ok(initialLoadBytes < allChunkBytes,
        "bounded-load byte proxy must be smaller than reading every persisted chunk");
    assert.equal(loaded.messageCount, 160);
    assert.equal(loaded.loadedMessageCount, 128);
    assert.deepEqual(loaded.messages.map(item => item.id),
        Array.from({ length: 128 }, (_, index) => `message-${index + 32}`));

    let workingMessages = loaded.messages;
    let loadedMessageCount = loaded.loadedMessageCount;
    for (let index = 160; index < 360; index++) {
        workingMessages = [...workingMessages, message(index)];
        const appendStart = fs.replaceRecords.length;
        await store.saveChat({
            id: chatId,
            title: "Long history",
            messages: workingMessages,
            lastModified: index + 1,
            loadedMessageCount
        });
        const appendWrites = fs.replaceRecords.slice(appendStart);
        const changedChunk = Math.floor(index / 32);
        const changedPaths = new Set([
            chunkPath(home, chatId, changedChunk),
            metadataPath(home, chatId)
        ]);
        assert.ok(appendWrites.length > 0 && appendWrites.length <= 2,
            "each append must replace only its changed chunk and metadata");
        assert.ok(appendWrites.every(write => changedPaths.has(write.path)),
            "each append must not replace unrelated history files");
        assert.ok(appendWrites.every(write => write.bytes <= Buffer.byteLength(fs.contents(write.path))),
            "filesystem accounting must report the complete bounded replacement content");
        const appendBytes = appendWrites.reduce((total, write) => total + write.bytes, 0);
        const boundedBytes = [...changedPaths]
                .reduce((total, filePath) => total + Buffer.byteLength(fs.contents(filePath)), 0);
        assert.ok(appendBytes <= boundedBytes,
            "each append transfer must be bounded by changed-chunk plus metadata bytes");
        loadedMessageCount = workingMessages.length;
    }
    await store.flush();

    const reloadedStore = new HistoryStore(home);
    await reloadedStore.initialize();
    const reloaded = await reloadedStore.loadChat(chatId);
    assert.ok(reloaded);
    assert.equal(reloaded.messageCount, 360);
    assert.equal(reloaded.loadedMessageCount, 104);
    assert.deepEqual(reloaded.messages.map(item => item.id),
        Array.from({ length: 104 }, (_, index) => `message-${index + 256}`));
    assert.equal(reloadedStore.getHistory()[0].messageCount, 360);

    const chunkFiles = fs.pathsUnder(`${historyRoot(home)}/${chatId}/chunks`)
            .sort()
            .map(filePath => JSON.parse(fs.contents(filePath)));
    assert.equal(chunkFiles.length, 12);
    assert.equal(chunkFiles.reduce((count, chunk) => count + chunk.length, 0), 360);
    assert.ok(chunkFiles.every(chunk => chunk.length <= 32));
    for (let chunk = 0; chunk < 5; chunk++) {
        const filePath = chunkPath(home, chatId, chunk);
        assert.equal(fs.replacePaths.filter(replacedPath => replacedPath === filePath).length, 1,
            `frequent appends must not rewrite old chunk ${chunk}`);
    }
    assert.equal(fs.openedHandles(), fs.closedHandles(), "all fake Cockpit file handles must close");
});

test("HistoryStore queue recovers after an interrupted atomic replace", async () => {
    const fs = createCockpitFileSystem();
    globalThis.__phase0Cockpit = fs.cockpit;
    const { HistoryStore } = await sourceModule("./src/lib/history-store.ts");
    const home = "/home/phase0";
    const chatId = "queue-recovery";
    const store = new HistoryStore(home);
    const initialMessages = [message(0), message(1)];

    await store.initialize();
    await store.saveChat({
        id: chatId,
        title: "Queue recovery",
        messages: initialMessages,
        lastModified: 1,
        loadedMessageCount: initialMessages.length
    });
    await store.flush();

    fs.failBeforeReplace(chunkPath(home, chatId, 0));
    await assert.rejects(
        store.saveChat({
            id: chatId,
            title: "Queue recovery",
            messages: [...initialMessages, message(2)],
            lastModified: 2,
            loadedMessageCount: initialMessages.length
        }),
        /interrupted replace/
    );

    const crashView = new HistoryStore(home);
    await crashView.initialize();
    const beforeRecovery = await crashView.loadChat(chatId);
    assert.ok(beforeRecovery);
    assert.deepEqual(beforeRecovery.messages.map(item => item.id), ["message-0", "message-1"],
        "a replace interrupted before commit must leave the previous snapshot readable");

    await store.saveChat({
        id: chatId,
        title: "Queue recovery",
        messages: [...initialMessages, message(2), message(3)],
        lastModified: 3,
        loadedMessageCount: initialMessages.length
    });
    await store.flush();

    const recoveredView = new HistoryStore(home);
    await recoveredView.initialize();
    const recovered = await recoveredView.loadChat(chatId);
    assert.ok(recovered);
    assert.deepEqual(recovered.messages.map(item => item.id),
        ["message-0", "message-1", "message-2", "message-3"]);
    assert.equal(recovered.messageCount, 4);
    assert.equal(fs.openedHandles(), fs.closedHandles(), "failed and successful handles must close");
});

test("McpClientManager keeps an unavailable optional server non-fatal", async () => {
    const fs = createCockpitFileSystem();
    fs.cockpit.spawn = argv => {
        if (argv[0] === "missing-mcp")
            throw new Error("MCP server unavailable");
        return Promise.resolve("");
    };
    globalThis.__phase0Cockpit = fs.cockpit;
    const { McpClientManager } = await sourceModule("./src/lib/mcp-client.ts");
    const manager = new McpClientManager();

    const connected = await withMutedConsole(() => manager.connectServer({
        id: "unavailable",
        name: "Unavailable optional server",
        transport: "stdio",
        command: "missing-mcp",
        enabled: true
    }));
    assert.equal(connected, false);
    await assert.doesNotReject(() => manager.refreshTools());
    assert.deepEqual(await manager.listAllTools(), []);
    await manager.close();
});

test("LlmClient aborts a slow stream without publishing late content", async () => {
    globalThis.__phase0Cockpit = {
        spawn() {
            throw new Error("host proxy should not be used by this fixture");
        }
    };
    const { LlmClient } = await sourceModule("./src/lib/llm-client.ts", { openai: slowLlmStub });
    const state = globalThis.__phase0SlowLlmState;
    const client = new LlmClient({
        apiKey: "test-key",
        baseUrl: "https://example.invalid/v1",
        model: "slow-fixture"
    });
    const controller = new AbortController();
    const chunks = [];
    let resolveFirstChunk;
    const firstChunk = new Promise(resolve => {
        resolveFirstChunk = resolve;
    });
    const response = client.chatCompletion(
        [{ id: "user", role: "user", content: "wait for the slow fixture" }],
        [],
        chunk => {
            chunks.push(chunk);
            resolveFirstChunk();
        },
        controller.signal
    );

    await firstChunk;
    assert.deepEqual(chunks, ["slow-prefix"]);
    controller.abort();
    await withMutedConsole(() => assert.rejects(response, error => error?.name === "AbortError"));
    assert.equal(state.createCalls, 1);
    assert.equal(state.aborted, true);
    assert.deepEqual(chunks, ["slow-prefix"], "cancellation must prevent late stream updates");
});

test("Diagnostics stays allowlisted and redacts credential-like values when enabled", async () => {
    const originalDebug = console.debug;
    const debugCalls = [];
    globalThis.__COCKPIT_COPILOT_AGENT_DIAGNOSTICS__ = true;
    console.debug = (...args) => debugCalls.push(args);

    try {
        const { diagnostics } = await sourceModule("./src/lib/diagnostics.ts");
        diagnostics.clear();
        diagnostics.record("llm.request", {
            model: "https://diagnostic-user:diagnostic-password@example.invalid/v1",
            status: "Bearer diagnostic-bearer-token",
            logicalRequestBytes: 42,
            apiKey: "sk-diagnostic-api-key",
            password: "diagnostic-password",
            baseUrl: "https://diagnostic-user:diagnostic-password@example.invalid/v1",
            unapprovedField: "diagnostic-unapproved-value"
        });
        diagnostics.record("not-an-allowlisted-event", {
            status: "diagnostic-unknown-event"
        });

        const records = diagnostics.getRecords();
        assert.equal(records.length, 1, "unknown diagnostic event names must be ignored");
        assert.deepEqual(Object.keys(records[0].fields).sort(), [
            "logicalRequestBytes",
            "model",
            "status"
        ]);
        const serializedRecords = JSON.stringify(records);
        const serializedConsole = JSON.stringify(debugCalls);
        for (const secret of [
            "diagnostic-api-key",
            "diagnostic-password",
            "diagnostic-bearer-token",
            "diagnostic-unapproved-value"
        ]) {
            assert.equal(serializedRecords.includes(secret), false,
                `diagnostic records must not expose ${secret}`);
            assert.equal(serializedConsole.includes(secret), false,
                `diagnostic console output must not expose ${secret}`);
        }
        assert.match(records[0].fields.status, /Bearer \[redacted\]/);
        assert.match(records[0].fields.model, /\[redacted\]@example\.invalid/);
    } finally {
        console.debug = originalDebug;
        globalThis.__COCKPIT_COPILOT_AGENT_DIAGNOSTICS__ = false;
    }
});

test("McpClientManager aggregates partial failures and propagates cancellation", async () => {
    const originalDebug = console.debug;
    const debugCalls = [];
    globalThis.__COCKPIT_COPILOT_AGENT_DIAGNOSTICS__ = true;
    console.debug = (...args) => debugCalls.push(args);

    const makeConnection = (id, name, listTools) => ({
        client: {
            listTools,
            close: async () => {}
        },
        transport: {
            close: async () => {}
        },
        config: { id, name, transport: "local" }
    });

    try {
        const { McpClientManager } = await sourceModule("./src/lib/mcp-client.ts");
        const manager = new McpClientManager();
        manager.clients.set("healthy", makeConnection("healthy", "Healthy", async () => ({
            tools: [{ name: "echo", inputSchema: { type: "object" } }]
        })));
        manager.clients.set("broken", makeConnection("broken", "Broken", async () => {
            throw new Error("synthetic MCP timeout");
        }));

        await assert.doesNotReject(() => manager.refreshTools(),
            "one failed optional server must not discard healthy MCP tools");
        const partialRecord = debugCalls
                .map(args => args[1])
                .find(record => record?.name === "mcp.refresh_tools");
        assert.equal(partialRecord?.fields?.status, "partial");
        assert.equal(partialRecord?.fields?.failedServers, 1);
        assert.equal(partialRecord?.fields?.toolCount, 1);

        const cancelledManager = new McpClientManager();
        cancelledManager.clients.set("slow", makeConnection("slow", "Slow", async (_request, options) =>
            new Promise((_resolve, reject) => {
                const abort = () => reject(new DOMException("Request aborted", "AbortError"));
                options.signal.addEventListener("abort", abort, { once: true });
            })));
        const controller = new AbortController();
        const pending = cancelledManager.refreshTools(controller.signal);
        controller.abort();
        await assert.rejects(pending, error => error?.name === "AbortError");
        await manager.close();
        await cancelledManager.close();
    } finally {
        console.debug = originalDebug;
        globalThis.__COCKPIT_COPILOT_AGENT_DIAGNOSTICS__ = false;
    }
});

const run = async () => {
    let failures = 0;
    for (const [index, { name, callback }] of tests.entries()) {
        try {
            await callback();
            console.log(`ok ${index + 1} - ${name}`);
        } catch (error) {
            failures++;
            console.error(`not ok ${index + 1} - ${name}`);
            console.error(error);
        }
    }
    console.log(`1..${tests.length}`);
    if (failures > 0)
        process.exitCode = 1;
};

await run();
