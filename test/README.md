# Deterministic Phase 0 tests

Run the dependency-light verification harness from the repository root:

```sh
node test/unit/phase0.test.mjs
```

The script is executable as well:

```sh
./test/unit/phase0.test.mjs
```

It uses Node built-ins plus the repository's existing `esbuild` dependency. It does not require a Cockpit VM, a live MCP server, a network connection, or an API key. The test bundles only the exercised TypeScript modules and injects behavioral doubles at the Cockpit/OpenAI boundaries.

The current checks cover:

- loading a long chat through exactly the metadata and last four chunks, with a path-count and byte-count proxy for bounded reads;
- appending frequently with replace/write byte accounting bounded to the changed chunk plus metadata, without rewriting any previously persisted chunk;
- queue recovery after a file replacement fails before its atomic commit;
- graceful handling of an unavailable optional stdio MCP server;
- partial MCP discovery aggregation and cancellation propagation;
- cancellation of a slow streaming LLM before late content is published;
- explicitly enabled diagnostics using allowlisted event/field names while redacting API keys, passwords, Bearer tokens, and credential-bearing URLs from records and console output.

These are contract fixtures, not a replacement for integration testing. Known gaps are:

- the file double models an atomic `replace()` failure before commit, but cannot reproduce a process crash between multiple chunk replacements and metadata replacement;
- the MCP check exercises transport startup failure, not a real HTTP timeout or a server that disappears after connecting;
- MCP aggregation and cancellation use injected client doubles, not a real MCP transport or provider process;
- the slow LLM check uses a deterministic async iterable, not a provider or host-helper process;
- the Cockpit browser lifecycle, permissions, rendering, and installed-package behavior still require the existing VM/browser test path;
- no performance threshold is asserted yet because the repository has no baseline timings for startup, history I/O, MCP discovery, or provider latency.
