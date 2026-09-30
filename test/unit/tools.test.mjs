#!/usr/bin/env node

import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

let moduleCounter = 0;

// Bundle a source module with "cockpit" replaced by globalThis.__toolsCockpit.
const sourceModule = async (entryPoint) => {
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
            name: "tools-cockpit-double",
            setup(buildContext) {
                buildContext.onResolve({ filter: /^cockpit$/ }, args => ({ namespace: "tools-cockpit", path: args.path }));
                buildContext.onLoad({ filter: /^cockpit$/, namespace: "tools-cockpit" }, () => ({
                    contents: "export default globalThis.__toolsCockpit;",
                    loader: "js"
                }));
            }
        }]
    });
    moduleCounter++;
    const bundled = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}#tools-${moduleCounter}`);
};

// A fake cockpit.spawn() with the stream()/reject semantics of cockpit.js:
// output is delivered through stream() and a non-zero exit rejects with a
// ProcessError-like object.
const fakeSpawn = (handler) => (argv, options) => {
    const { output = "", exitStatus = 0, problem } = handler(argv, options);
    let callback = () => {};
    const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
            if (output)
                callback(output);
            if (problem)
                reject({ problem, message: problem, exit_status: null });
            else if (exitStatus !== 0)
                reject({ problem: null, message: `exited with ${exitStatus}`, exit_status: exitStatus });
            else
                resolve(callback.streamed ? "" : output);
        }, 0);
    });
    promise.stream = (fn) => {
        callback = (data) => fn(data);
        callback.streamed = true;
        return promise;
    };
    return promise;
};

const home = "/home/tester";
globalThis.__toolsCockpit = {
    info: { user: { home, name: "tester", uid: 1000, groups: ["tester"] } },
    spawn: fakeSpawn(() => ({ output: "" }))
};

const tests = [];
const test = (name, callback) => tests.push({ name, callback });

const builtin = (originalName, isLowRisk = true) => ({
    serverId: "builtin",
    originalName,
    builtin: true,
    tool: { name: `system_tools__${originalName}`, inputSchema: { type: "object" }, _meta: { isLowRisk } }
});

test("parseUnitList keeps failed units that systemctl marks with a bullet", async () => {
    const { parseUnitList } = await sourceModule("./src/lib/mcp/tools/systemd.ts");
    const units = parseUnitList([
        "  cron.service      loaded active running Regular background program processing daemon",
        "● nginx.service     loaded failed failed  A high performance web server",
        "  ghost.service     not-found inactive dead ghost.service",
        ""
    ].join("\n"));
    assert.deepEqual(units.map(unit => unit.unit), ["cron.service", "nginx.service", "ghost.service"]);
    assert.equal(units[1].status, "failed");
    assert.equal(units[1].sub, "failed");
    assert.equal(units[1].description, "A high performance web server");
    assert.equal(units[2].load, "not-found");
});

test("isSensitivePath flags secrets after lexical normalization", async () => {
    const { isSensitivePath, normalizePath } = await sourceModule("./src/lib/tool-policy.ts");
    assert.equal(normalizePath("/etc//./nginx/../hosts", home), "/etc/hosts");
    assert.equal(normalizePath("~/notes.txt", home), `${home}/notes.txt`);
    assert.equal(normalizePath("relative/file", home), null);

    for (const sensitive of [
        "/etc/shadow",
        "/etc/nginx/../shadow",
        "/etc/cockpit/copilot.credentials.json",
        "~/.ssh/id_ed25519",
        `${home}/.ssh/config`,
        "/root/.bash_history",
        "/srv/app/.env",
        "/srv/app/.env.production",
        "/etc/ssl/private/server.key",
        "/etc/ssh/ssh_host_ed25519_key",
        "/proc/1/environ",
        `${home}/.aws/credentials`,
        "relative/path",
    ])
        assert.equal(isSensitivePath(sensitive, home), true, sensitive);

    for (const ordinary of ["/etc/hosts", "/etc/nginx/nginx.conf", "/var/log/syslog", `${home}/notes.txt`, "/etc/ssh/sshd_config"])
        assert.equal(isSensitivePath(ordinary, home), false, ordinary);
});

test("requiresApproval ignores risk metadata from external servers", async () => {
    const { requiresApproval } = await sourceModule("./src/lib/tool-policy.ts");
    const external = {
        serverId: "remote",
        originalName: "drop_database",
        builtin: false,
        tool: { name: "remote__drop_database", inputSchema: { type: "object" }, _meta: { isLowRisk: true } }
    };
    assert.equal(requiresApproval(external, {}, home), true);
    assert.equal(requiresApproval(builtin("service_list"), {}, home), false);
    assert.equal(requiresApproval(builtin("service_action", false), {}, home), true);
    assert.equal(requiresApproval(builtin("file_read"), { path: "/etc/hosts" }, home), false);
    assert.equal(requiresApproval(builtin("file_read"), { path: "/etc/shadow" }, home), true);
    assert.equal(requiresApproval(builtin("file_read"), {}, home), true);
    assert.equal(requiresApproval(builtin("file_list"), { path: "~/.ssh" }, home), true);
    assert.equal(requiresApproval(undefined, {}, home), false);
});

test("McpClientManager strips isLowRisk from non-builtin servers", async () => {
    const { McpClientManager } = await sourceModule("./src/lib/mcp-client.ts");
    const manager = new McpClientManager();
    const tools = [{ name: "probe", inputSchema: { type: "object" }, _meta: { isLowRisk: true } }];
    const connection = (id, transport) => ({
        client: { listTools: async () => ({ tools }), close: async () => {} },
        transport: { close: async () => {} },
        config: { id, name: id, transport }
    });
    manager.clients.set("builtin", connection("builtin", "local"));
    manager.clients.set("remote", connection("remote", "http"));
    manager.clients.set("impostor", connection("impostor", "local"));

    const listed = await manager.listAllTools();
    const byServer = Object.fromEntries(listed.map(reference => [reference.serverId, reference]));
    assert.equal(byServer.builtin.builtin, true);
    assert.equal(byServer.builtin.tool._meta?.isLowRisk, true);
    assert.equal(byServer.remote.builtin, false);
    assert.equal(byServer.remote.tool._meta, undefined);
    assert.equal(byServer.impostor.builtin, false);
    assert.equal(byServer.impostor.tool._meta, undefined);
    await manager.close();
});

test("execute keeps output and exit code of failed commands", async () => {
    const spawned = [];
    globalThis.__toolsCockpit.spawn = fakeSpawn((argv, options) => {
        spawned.push({ argv, options });
        if (argv[2] === "grep missing /etc/hosts")
            return { output: "", exitStatus: 1 };
        if (argv[2] === "ls /nope")
            return { output: "ls: cannot access '/nope': No such file or directory\n", exitStatus: 2 };
        if (argv[0] === "not-installed")
            return { problem: "not-found" };
        return { output: "hello\n" };
    });
    const { execute, formatResult } = await sourceModule("./src/lib/mcp/tools/exec.ts");
    const shell = await sourceModule("./src/lib/mcp/tools/shell.ts");

    assert.equal(await shell.run("echo hello"), "hello");
    assert.equal(spawned[0].options.err, "out", "stderr must be merged so failures are explained");
    assert.equal(await shell.run("grep missing /etc/hosts"), "[exit code: 1]");
    assert.equal(await shell.run("ls /nope"), "ls: cannot access '/nope': No such file or directory\n[exit code: 2]");

    const missing = await execute(["not-installed"]);
    assert.equal(missing.exitCode, -1);
    assert.equal(formatResult(missing), "[failed to run: not-found]");
});

test("readFile refuses a symlink that points at a sensitive file", async () => {
    globalThis.__toolsCockpit.spawn = fakeSpawn(argv => {
        if (argv[0] === "realpath")
            return { output: argv[3] === "/tmp/innocent" ? "/etc/shadow\n" : `${argv[3]}\n` };
        return { output: "" };
    });
    let opened = 0;
    globalThis.__toolsCockpit.file = () => {
        opened++;
        return { read: async () => "content", close() {} };
    };
    const files = await sourceModule("./src/lib/mcp/tools/files.ts");
    assert.match(await files.readFile("/tmp/innocent"), /resolves to \/etc\/shadow/);
    assert.equal(opened, 0);
    assert.equal(await files.readFile("/etc/hosts"), "content");
    // An explicitly requested sensitive path has already been approved.
    assert.equal(await files.readFile("/etc/shadow"), "content");
});

test("buildJournalCommand maps filters and bounds line count", async () => {
    const { buildJournalCommand, MAX_JOURNAL_LINES } = await sourceModule("./src/lib/mcp/tools/logs.ts");
    assert.deepEqual(buildJournalCommand({}), ["journalctl", "--no-pager", "-n", "50"]);
    assert.deepEqual(
        buildJournalCommand({ service: "nginx.service", lines: 20, priority: "err", since: "-1h", grep: "timeout", boot: -1, kernel: true }),
        ["journalctl", "--no-pager", "-n", "20", "-u", "nginx.service", "-p", "err", "--since", "-1h",
            "--grep", "timeout", "--case-sensitive=false", "-b", "-1", "-k"]);
    assert.equal(buildJournalCommand({ lines: 1e9 })[3], String(MAX_JOURNAL_LINES));
    assert.equal(buildJournalCommand({ lines: -5 })[3], "1");
});

test("parseMeminfo reads the fields used for memory usage", async () => {
    const { parseMeminfo } = await sourceModule("./src/lib/mcp/tools/system.ts");
    const values = parseMeminfo("MemTotal:  2048 kB\nMemFree: 10 kB\nMemAvailable:  1024 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
    assert.deepEqual(values, { MemTotal: 2048 * 1024, MemAvailable: 1024 * 1024, SwapTotal: 0, SwapFree: 0 });
});

test("argument validation rejects option-looking values before spawning", async () => {
    const spawned = [];
    globalThis.__toolsCockpit.spawn = fakeSpawn(argv => {
        spawned.push(argv);
        return { output: "" };
    });
    const packages = await sourceModule("./src/lib/mcp/tools/packages.ts");
    const users = await sourceModule("./src/lib/mcp/tools/users.ts");
    const network = await sourceModule("./src/lib/mcp/tools/network.ts");

    assert.match(await packages.install(["--allow-downgrades"]), /invalid package name/);
    assert.match(await packages.remove([]), /invalid package name/);
    assert.match(await packages.search("-x"), /invalid search query/);
    assert.match(await users.modifyUser("-o", "lock"), /invalid user name/);
    assert.match(await users.modifyUser("alice", "add_group", "--root=/"), /invalid group name/);
    assert.match(await users.modifyUser("alice", "add_group"), /group is required/);
    assert.match(await network.checkConnectivity("-f example.com"), /invalid host/);
    assert.deepEqual(spawned, [], "invalid arguments must not reach cockpit.spawn");
});

test("listUpdates treats the manager's 'updates available' exit code as success", async () => {
    globalThis.__toolsCockpit.spawn = fakeSpawn(argv => {
        const command = argv.join(" ");
        if (command.startsWith("sh -c command -v"))
            return { output: argv[3] === "dnf" ? "/usr/bin/dnf\n" : "", exitStatus: argv[3] === "dnf" ? 0 : 1 };
        if (command === "dnf check-update -q")
            return { output: "\nkernel.x86_64  6.9.1-100.fc40  updates\nopenssl.x86_64  3.2.2-1.fc40  updates\n", exitStatus: 100 };
        if (argv[0] === "needs-restarting")
            return { output: "Reboot is required to fully utilize these updates.\n", exitStatus: 1 };
        return { output: "" };
    });
    globalThis.__toolsCockpit.file = () => ({ read: async () => { throw new Error("ENOENT") }, close() {} });
    const packages = await sourceModule("./src/lib/mcp/tools/packages.ts");
    const report = await packages.listUpdates(false);
    assert.match(report, /Available updates \(dnf, 2\)/);
    assert.match(report, /kernel\.x86_64/);
    assert.match(report, /^Reboot required\./m);
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
