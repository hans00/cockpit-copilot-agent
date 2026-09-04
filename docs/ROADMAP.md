# Cockpit Copilot Agent Roadmap

Status: Proposed

This document describes the product and architecture roadmap for Cockpit Copilot Agent. It compares the project with capabilities that are becoming standard in mainstream coding agents, then adapts those capabilities to Cockpit's host-administration use case.

The goal is not to turn Cockpit into an IDE. The goal is to make host operations observable, bounded, resumable, verifiable, and efficient while preserving Cockpit's existing authorization model.

## 1. Executive Summary

The current project already has the foundation of an agentic host-management experience:

- streaming chat with an iterative tool loop;
- built-in system tools and optional MCP servers;
- approval prompts and cancellation;
- bounded, chunked per-user chat history;
- cached MCP tool discovery and bounded tool output;
- deferred optional MCP setup and parallelized startup work;
- an optional host-side LLM transport adapter for custom OpenAI-compatible endpoints.

The largest remaining gap is the control plane around the agent loop. Mainstream agents increasingly provide an explicit task lifecycle, plan mode, fine-grained approvals, audit logs, resumable background work, context compaction, reusable agent profiles, and specialized subagents. VS Code documents this as a loop of context gathering, tool action, validation, and review, while Claude Code exposes plan mode, bounded turns, session resume, and machine-readable output. [VS Code Agents](https://code.visualstudio.com/docs/agents/concepts/agents) · [Claude Code CLI](https://code.claude.com/docs/en/cli-usage)

For this project, the highest-value sequence is:

1. measure startup, history, MCP, and LLM latency;
2. introduce a persisted task state machine;
3. add policy-based approvals, audit events, and verification contracts;
4. separate chat history, task events, and large artifacts;
5. add background jobs and resume;
6. add Cockpit-specific runbooks, structured results, profiles, and automation;
7. consider subagents and multi-host workflows only after mutation locking and durable execution exist.

## 2. Current Baseline and Architectural Constraints

### 2.1 Current implementation baseline

The current implementation is concentrated in the following areas:

| Area | Current location | Current behavior |
| --- | --- | --- |
| Agent loop | [`src/lib/agent.ts`](../src/lib/agent.ts) | Streams responses, executes up to a bounded number of tool iterations, requests approval, supports cancellation, and persists the resulting chat. |
| Chat model | [`src/lib/types.ts`](../src/lib/types.ts) | Models basic chat messages, tool calls, tool results, MCP tools, settings, and chat summaries. |
| History persistence | [`src/lib/history-store.ts`](../src/lib/history-store.ts) | Stores per-user chat data in bounded chunks, loads only a recent window initially, appends incrementally, and migrates the legacy single-file format. |
| MCP management | [`src/lib/mcp-client.ts`](../src/lib/mcp-client.ts) | Supports local, stdio, and Streamable HTTP transports, caches tool lists, limits request time, and caps tool output. |
| Host tools | [`src/lib/mcp/mcp-server-local.ts`](../src/lib/mcp/mcp-server-local.ts) | Provides systemd, packages, disks, files, network, users, logs, shell, and optional host-plugin tools. |
| Chat UI | [`src/components/ChatPanel.tsx`](../src/components/ChatPanel.tsx) | Displays the conversation, tool approval cards, streaming output, cancellation, and regeneration. |
| Shared settings | [`src/lib/settings.ts`](../src/lib/settings.ts) | Loads and saves host-wide settings; the API key is kept in a separate shared credentials file. |
| Custom endpoint transport | [`src/llm-proxy.py`](../src/llm-proxy.py) | Adapts a custom OpenAI-compatible endpoint to Cockpit transport constraints. |

### 2.2 Authorization and data ownership

The following are deliberate product decisions and must remain explicit in future work:

- `/etc/cockpit/copilot-settings.json` is shared by all authorized users of the host.
- `/etc/cockpit/copilot.credentials.json` is also shared by all authorized users.
- Chat history is per user under `~/.local/share/cockpit/copilot-chats/`.
- Authorized host users may be able to read host files, including credential files, through other host access paths. The host-side helper is therefore not a security boundary.
- The helper exists to adapt the custom LLM transport and avoid registering arbitrary custom endpoint URLs in the Cockpit manifest CSP. It must not be described as a backend proxy, Cockpit bridge, user-isolation layer, or secret store.
- Cockpit does not provide a custom server-endpoint registration architecture for this application. Any future durable service or scheduler must be designed as a separate host component, not assumed to be a Cockpit extension endpoint.

This means that future policy features can provide shared host-wide defaults, per-session approval scopes, and user attribution in audit records, but must not promise credential isolation between authorized users.

### 2.3 Product principles

1. **Evidence before explanation.** Separate observed host state from model hypotheses.
2. **Plan before mutation.** Mutating work should have an explicit plan, risk, and verification path.
3. **Approval is policy, not a boolean.** Risk, scope, target, and operation type matter.
4. **Every long operation is a job.** The browser must not be the only owner of execution state.
5. **History is not an event log.** Chat, audit events, and large outputs have different retention and query needs.
6. **Optimize the critical path.** Startup and first usable interaction must not wait for optional integrations or unbounded data.
7. **Use Cockpit-native strengths.** Prefer system health, service operations, runbooks, and host evidence over IDE-centric inline completion.

## 3. Mainstream Agent Capability Comparison

The following capabilities are now common reference points in mainstream agent products:

| Capability | Mainstream pattern | Cockpit adaptation | Priority |
| --- | --- | --- | --- |
| Task lifecycle | Plan, execute, validate, review | Host task runs with explicit phases and persisted state | P0 |
| Permissions | Per-tool, per-command, per-URL, session-scoped approval | Risk and target policy for services, packages, files, network, reboot, and external data transmission | P0 |
| Auditability | Session logs, tool traces, commit/session links | Host operation timeline with identity, command preview, result, verification, and rollback | P0 |
| Context control | Tool selection, context budgets, compaction | Relevant-tool selection, bounded host evidence, summary checkpoints, and separate artifact references | P0 |
| Resumability | Continue/resume sessions and background agents | Durable host jobs that survive page reload and reconnect | P1 |
| Reusable behavior | Rules, skills, custom agents | Host-wide profiles and runbooks for incident, storage, network, service, and security workflows | P1 |
| Validation | Tests, browser checks, review, checkpoints | Preconditions, postconditions, health checks, diff review, and rollback contracts | P0 |
| Parallel delegation | Isolated subagents | Diagnostic, planner, executor, and verifier roles with mutation locks | P2 |
| Automation | Scheduled or event-triggered agents | Maintenance windows, failed-service alerts, health checks, and controlled remediation | P2 |

VS Code supports high-level permission modes plus fine-grained tool, URL, and terminal approval, including approval scopes and sandboxing. [VS Code Approvals and Permissions](https://code.visualstudio.com/docs/agents/run/approvals) Its tool model also supports selecting relevant tools, editing parameters before approval, background terminals, and browser-based validation. [VS Code Tools](https://code.visualstudio.com/docs/agents/run/tools)

GitHub Copilot supports custom agents with scoped instructions, tools, models, and MCP servers, as well as isolated subagent contexts and lifecycle events. [GitHub Custom Agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration) · [GitHub Subagent Orchestration](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents) Cursor provides reusable rules, long-lived goals, background agents, and scheduled/event-driven automations. [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) · [Cursor Background Agents](https://cursor.com/docs/agent/overview) · [Cursor Automations](https://prod.cursor.com/help/ai-features/automations)

## 4. Proposed Target Architecture

The agent loop should evolve into a task-oriented state machine rather than accumulating more conditional behavior inside a single loop.

### 4.1 Core domain objects

```text
TaskRun {
  id, chatId, hostId, userId, mode, phase, state,
  startedAt, updatedAt, deadline, cancellationState
}

PlanStep {
  id, taskId, sequence, title, intent, risk,
  dependencies, target, proposedAction, verification, rollback
}

TaskEvent {
  sequence, taskId, timestamp, type, actor,
  toolCallId, redactedArguments, outputRef, duration,
  approvalDecision, error, metadata
}

PermissionPolicy {
  operation, target, risk, approvalMode,
  scope, allowedTools, deniedTools, maintenanceWindow
}

ArtifactRef {
  id, taskId, kind, path, size, sha256,
  preview, redactionState, expiresAt
}

BackgroundJob {
  id, taskId, commandOrOperation, state,
  progress, startedAt, finishedAt, outputRef,
  cancelable, resumable
}
```

### 4.2 State flow

```text
created
  -> analyzing
  -> planned
  -> awaiting_approval
  -> executing
  -> verifying
  -> completed

executing -> failed -> recovery_available
executing -> cancelled
verifying -> rollback_available -> rolled_back
```

The model may propose plans and actions, but the runtime owns state transitions, approval enforcement, cancellation, timeouts, locking, persistence, and verification status.

### 4.3 Storage separation

Use separate stores or namespaces for:

- **Chat history:** user-facing conversation and compact summaries.
- **Task events:** append-only execution and approval timeline.
- **Artifacts:** large command output, journal exports, diffs, snapshots, and evidence bundles.
- **Configuration:** shared host-wide settings and credentials.
- **Job state:** durable background operation status.

Large output should not be copied repeatedly into chat history or sent back to the model without a bounded preview and explicit relevance selection.

## 5. Prioritized Feature Plan

### Phase 0 — Measurement and Contracts

#### What to implement

- Add opt-in or development-only startup timing for Cockpit readiness, settings, credentials, first paint, local MCP initialization, tool discovery, system context, and first usable chat state.
- Measure history index bytes, loaded chunks, history read time, write queue time, bytes transmitted, and migration time.
- Measure MCP connection time, tool-list latency, tool-schema size, tool-call latency, output size, timeout, and cache hit rate.
- Define budgets before optimizing further:
  - first usable UI;
  - first usable local tools;
  - first prompt submission;
  - maximum index size;
  - maximum model context size;
  - maximum tool output preview;
  - maximum concurrent jobs.
- Add deterministic fixtures for long history, frequent appends, interrupted writes, unavailable MCP servers, and slow LLM responses.

#### Documentation references

- [`src/lib/agent.ts`](../src/lib/agent.ts) for the current initialization and loop boundaries.
- [`src/lib/history-store.ts`](../src/lib/history-store.ts) for chunking, migration, and write queues.
- [`src/lib/mcp-client.ts`](../src/lib/mcp-client.ts) for connection, tool discovery, timeout, and output limits.
- [`src/index.html`](../src/index.html) and [`src/index.tsx`](../src/index.tsx) for the browser critical path.

#### Verification checklist

- Capture a baseline on a representative host and a slow host.
- Test with empty, medium, and very large history.
- Test with zero, one, and several MCP servers, including one unavailable server.
- Confirm telemetry never contains API keys or unredacted credentials.
- Keep a before/after table in the change description for every performance change.

#### Anti-pattern guards

- Do not optimize based only on wall-clock impressions.
- Do not add permanent verbose logging of prompts, keys, or tool output.
- Do not make optional MCP or legacy migration part of the first usable UI path.

### Phase 1 — Task Lifecycle, Plan Mode, and Audit

#### What to implement

- Introduce `TaskRun`, `PlanStep`, and `TaskEvent` types.
- Add plan mode that permits read-only evidence gathering and produces a structured plan.
- Render task phases and step status in the UI.
- Persist an append-only, redacted event stream.
- Add task pause, cancel, retry, and resume-state semantics.
- Add a task summary that distinguishes facts, changes, verification evidence, unresolved risks, and recommended next actions.
- Provide export to JSON and Markdown for incident handoff.

#### Documentation references

- [VS Code Agents](https://code.visualstudio.com/docs/agents/concepts/agents), especially agent loop, planning, validation, and review.
- [GitHub Agent Sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents) for session progress and traceability patterns.
- [`src/lib/agent.ts`](../src/lib/agent.ts) for the current loop that will be migrated behind the task runtime.
- [`src/components/ChatPanel.tsx`](../src/components/ChatPanel.tsx) for the current conversation and approval presentation.

#### Verification checklist

- A plan-only task cannot invoke mutating tools.
- Refreshing the page does not lose completed task events.
- Every tool call has a task ID, sequence number, duration, and outcome.
- Exported records contain redacted arguments and no API key.
- Event ordering remains correct when tool calls fail or are cancelled.

#### Anti-pattern guards

- Do not treat the model's textual plan as the authoritative state.
- Do not use chat message order as the audit log.
- Do not allow a regenerated assistant response to duplicate a committed mutation without an idempotency check.

### Phase 2 — Permission Policy, Preview, Verification, and Rollback Contracts

#### What to implement

- Replace the broad shell-access decision with operation metadata:
  - read-only inspection;
  - service restart or stop;
  - configuration write;
  - package install, removal, or upgrade;
  - user/account change;
  - network change;
  - reboot or shutdown;
  - destructive storage operation;
  - external network transmission.
- Add policy dimensions for tool, command, path, service, package, host, risk, and approval scope.
- Support single-call, task, session, and host-policy approval scopes.
- Show exact command arguments, target resources, expected impact, and estimated duration before approval.
- Add preconditions, postconditions, verification commands, and rollback availability to mutating tools.
- Add dry-run and diff previews where the underlying operation supports them.
- Add host/service mutation locks and idempotency keys.

#### Documentation references

- [VS Code Approvals and Permissions](https://code.visualstudio.com/docs/agents/run/approvals) for permission levels, per-tool approval, URL approval, terminal command rules, and sandboxing.
- [GitHub Copilot Hooks](https://docs.github.com/en/copilot/concepts/agents/hooks) for pre-tool and post-tool policy hooks.
- [`src/lib/types.ts`](../src/lib/types.ts) for current tool metadata and settings types.
- [`src/lib/mcp/mcp-server-local.ts`](../src/lib/mcp/mcp-server-local.ts) and [`src/lib/mcp/tools`](../src/lib/mcp/tools) for operation-specific metadata and verification contracts.

#### Verification checklist

- A read-only plan cannot bypass a mutating-tool policy.
- A dangerous operation always requires explicit approval, even if the tool is marked low risk incorrectly.
- Approval scope is visible and cannot silently become host-wide.
- Concurrent tasks cannot mutate the same service or target simultaneously.
- Failed verification marks the task incomplete and presents available recovery or rollback actions.
- A rollback that is unavailable is clearly reported rather than implied.

#### Anti-pattern guards

- Do not treat `_meta.isLowRisk` as sufficient authorization for all future tools.
- Do not implement policy only in the host-side LLM helper.
- Do not claim that shared credentials or host authorization provide user isolation.
- Do not automatically retry non-idempotent or destructive actions.

### Phase 3 — Context, History, and Transport Efficiency

#### What to implement

- Replace fixed message-count truncation with a token-budget-aware context builder.
- Compact older turns into a signed or versioned task summary.
- Allow users to pin facts, decisions, files, services, and evidence.
- Store large tool output as `ArtifactRef` with a bounded preview and on-demand retrieval.
- Add `/compact`, `/summarize`, `/export`, and `/clear-artifacts` actions.
- Add history search and filtering without loading every message into the model context.
- Keep the chat index small and use incremental writes with crash-safe metadata updates.
- Make LLM payload size, context usage, history bytes, and retry count observable.
- Cache stable system context and tool catalogs across chat turns and, where safe, across page reloads.

#### Documentation references

- [VS Code Tools](https://code.visualstudio.com/docs/agents/run/tools) for selecting relevant tools and reducing unnecessary context.
- [Cursor Prompting](https://prod.cursor.com/docs/agent/prompting) for context usage and conversation compression patterns.
- [`src/lib/history-store.ts`](../src/lib/history-store.ts) for the existing bounded-chunk persistence design.
- [`src/lib/llm-client.ts`](../src/lib/llm-client.ts) for request construction and streaming transport.

#### Verification checklist

- A very long chat keeps the model payload under a configured budget.
- Repeated tool results do not cause unbounded request growth.
- History remains readable after interrupted writes and partial migration.
- Large output can be searched or reopened without being injected into every request.
- A page reload does not duplicate or lose an appended message.
- Startup and first-prompt latency improve against the Phase 0 baseline.

#### Anti-pattern guards

- Do not use character count as a substitute for token budgeting across providers.
- Do not send every MCP schema on every turn when a relevant subset is known.
- Do not put full journal files, diffs, or command output in the chat index.
- Do not add an LLM call to the startup critical path for titles, summaries, or tool classification.

### Phase 4 — Durable Jobs, Structured Results, and Cockpit Workflows

#### What to implement

- Add a durable job manager for package operations, SMART tests, backups, image pulls, journal collection, and long-running recovery procedures.
- Persist job progress, cancellation, timeout, output references, and verification state.
- Resume jobs after page reload or reconnect.
- Add notification states for approval required, job complete, job failed, and rollback required.
- Define structured result cards such as `ServiceHealth`, `DiskHealth`, `PackageTransaction`, `PortTable`, `JournalGroup`, and `ConfigDiff`.
- Add Incident Mode that collects bounded evidence before proposing a diagnosis.
- Add runbooks with explicit inputs, allowed tools, risk, maintenance-window requirements, verification, and rollback.
- Add host snapshots and before/after comparison for services, packages, ports, mounts, selected configuration files, and system health.

#### Documentation references

- [Claude Code CLI](https://code.claude.com/docs/en/cli-usage) for resume, continue, bounded turns, permission modes, and JSON output.
- [Cursor Agent Overview](https://cursor.com/docs/agent/overview) for steering active runs and long-lived goals.
- [VS Code Tools](https://code.visualstudio.com/docs/agents/run/tools) for background terminal and browser-based validation patterns.
- [`src/lib/mcp/tools`](../src/lib/mcp/tools) for existing host-operation boundaries.

#### Verification checklist

- A job remains observable after the browser is closed and reopened.
- Cancellation reaches the underlying process and is reflected in task state.
- Job output is bounded in the model context and retained as an artifact.
- Each runbook step has a verification result.
- A failed step stops dependent steps unless the runbook explicitly allows recovery.
- A snapshot comparison identifies changes made by the task and changes made externally.

#### Anti-pattern guards

- Do not make the browser tab the durable owner of a host operation.
- Do not represent background work as a fake streaming assistant message.
- Do not promise universal rollback for package, network, storage, or arbitrary shell operations.
- Do not run a remediation runbook without a maintenance-window and cancellation policy.

### Phase 5 — Profiles, Skills, Tool Catalogs, and Hooks

#### What to implement

- Add host-wide profiles such as Read-only Auditor, Incident Responder, Service Administrator, Storage Administrator, Network Troubleshooter, Container Administrator, and Security Hardening Reviewer.
- Let profiles declare system instructions, allowed tools, risk policies, required verification, output schemas, and optional model routing.
- Add user-local preferences separately from shared profiles and shared settings.
- Add tool categories and a tool picker for services, storage, network, packages, logs, files, users, and containers.
- Add lazy tool discovery and a schema budget.
- Add policy hooks around task, prompt, tool, verification, error, cancellation, and completion events.
- Add provider capability negotiation for tool calling, streaming, structured output, and context limits.

#### Documentation references

- [GitHub Custom Agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration) for scoped prompts, tools, models, and MCP servers.
- [GitHub Copilot Hooks](https://docs.github.com/en/copilot/concepts/agents/hooks) for lifecycle enforcement and audit integration.
- [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) for reusable, version-controlled instructions.
- [`src/lib/mcp-client.ts`](../src/lib/mcp-client.ts) for the current tool catalog and cache boundary.

#### Verification checklist

- A profile cannot enable a tool denied by the host-wide policy.
- Tool selection is visible in the task UI.
- A tool metadata change invalidates the relevant catalog cache.
- Hooks cannot silently loosen a stricter policy decision.
- Shared profiles affect all authorized users as documented; user-local preferences do not overwrite security policy.

#### Anti-pattern guards

- Do not copy IDE repository rules into a claim of host security.
- Do not allow arbitrary profile files to grant shell or network permissions.
- Do not use profile selection to bypass approval or mutation locks.
- Do not assume every provider supports the same tool-call or structured-output behavior.

### Phase 6 — Automation, Subagents, and Multi-Host Operations

#### What to implement

- Add scheduled and event-triggered health checks through a durable host-side service or scheduler.
- Support maintenance windows, notification targets, maximum cost/turn limits, and a “report only versus remediate” mode.
- Add specialist subagents for diagnosis, security review, planning, execution, and verification.
- Run subagents in separate contexts and return typed results to the parent task.
- Require mutation locks and a single operation owner for host/service changes.
- Add explicit multi-host selection only after every tool event and result carries a host identity.
- Add host inventory, per-host capability discovery, cross-host concurrency limits, and failure isolation.

#### Documentation references

- [GitHub Subagent Orchestration](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents) for isolated contexts, scoped tools, and lifecycle events.
- [Cursor Automations](https://prod.cursor.com/help/ai-features/automations) for schedules, webhooks, quality thresholds, and act-versus-do-nothing decisions.
- [VS Code Agents Window](https://code.visualstudio.com/docs/agents/run/agents-window) for multiple active sessions and parallel tracking.

#### Verification checklist

- Scheduled tasks are disabled by default until explicitly configured.
- An automation cannot perform destructive remediation without a policy and approval mode that explicitly permits it.
- Subagents cannot mutate the same target concurrently.
- A failed host in a multi-host task does not hide results from other hosts.
- Every result, notification, and audit event identifies the host.
- Restarting the durable service does not lose task ownership or produce duplicate operations.

#### Anti-pattern guards

- Do not implement autonomous host remediation before audit, locking, verification, and rollback contracts exist.
- Do not treat subagents as a way to bypass the parent task's permissions.
- Do not make multi-host mutation the first multi-host feature; begin with read-only inventory and health comparison.
- Do not assume Cockpit itself provides the scheduler or custom endpoint needed by automation.

## 6. Additional Feature Backlog

The following features are useful candidates once the foundation above exists.

### Host operations

- Service dependency graph and impact preview.
- Package update plan with reboot requirement detection.
- Configuration drift detection and baseline comparison.
- Certificate expiration checks.
- Open-port and firewall exposure report.
- Filesystem capacity forecast and inode health.
- Container health, image age, and resource trend report.
- Pre-reboot health check and post-reboot verification.
- Maintenance report generation in Markdown, JSON, or HTML.

### Interaction and productivity

- Slash commands such as `/status`, `/incident`, `/logs`, `/plan`, `/verify`, `/rollback`, `/compact`, and `/export`.
- Evidence attachments for services, journal entries, files, snapshots, and screenshots.
- Full-text history search with tags, pinning, retention, and per-user quotas.
- Notification center for pending approvals and background jobs.
- Model routing between fast, strong, local, and custom providers.
- Cost, token, latency, cache-hit, and tool-failure indicators.
- Read-only “explain this host” and “explain this command” modes.

### Engineering and operations

- Mock MCP transport and deterministic fake LLM for tests.
- Property tests for history chunking, migration, append ordering, and crash recovery.
- Golden scenarios for safe, mutating, destructive, denied, timed-out, and rolled-back operations.
- Agent replay from an event log without re-executing mutations.
- Provider compatibility test matrix for streaming, tool calls, errors, and structured output.
- Startup performance regression gate in CI or the VM test suite.
- Opt-in diagnostic bundle that excludes credentials and redacts sensitive host data.

### Lower-fit features to defer

- Inline code completion.
- IDE-style semantic refactoring.
- Remote repository coding agents and pull-request creation as a primary workflow.
- Default “YOLO” autonomy for host mutation.
- Browser automation that can navigate arbitrary external sites without URL and response review.

These may be useful in a future repository-focused mode, but they do not address the central Cockpit problem as directly as host evidence, controlled operations, durable jobs, and verification.

## 7. Success Metrics and Acceptance Criteria

### Performance

- First usable UI and first usable local tool availability are measured separately.
- Optional MCP connection failures do not block first usable UI.
- History load time remains bounded as the number of sessions and messages grows.
- A single appended message does not rewrite the complete history corpus.
- Tool schemas and tool outputs remain within configured byte/token budgets.
- Startup regressions fail an explicit performance check rather than being discovered manually.

### Reliability

- A page reload does not lose committed task events.
- A cancelled task cannot continue mutating after cancellation is acknowledged.
- A timed-out operation has a visible terminal state and retained output.
- Duplicate retries are prevented for non-idempotent operations.
- MCP reconnection and tool-list invalidation do not produce stale tool execution.

### Safety and auditability

- Every mutation has an explicit risk classification and approval decision.
- Every mutation has a visible verification outcome.
- Audit records identify the Cockpit user, host, task, tool, target, and result.
- API keys are never written to chat history, task events, telemetry, or exported artifacts.
- Shared authorization and shared credential behavior is documented in the UI and documentation.
- The host-side helper is documented and tested as a transport adapter only.

### User experience

- Users can understand what the Agent is doing without reading raw model prose.
- Users can stop, resume, inspect, retry, export, and review a task.
- Long-running work provides progress and does not require an open browser tab.
- The final response clearly separates facts, actions, verification, risks, and next steps.

## 8. Mainstream References

These first-party documents informed the comparison in this roadmap:

- [VS Code Agents](https://code.visualstudio.com/docs/agents/concepts/agents)
- [VS Code Approvals and Permissions](https://code.visualstudio.com/docs/agents/run/approvals)
- [VS Code Tools](https://code.visualstudio.com/docs/agents/run/tools)
- [VS Code Hooks Reference](https://code.visualstudio.com/docs/agents/reference/hooks-reference)
- [GitHub Custom Agents Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [GitHub Copilot Hooks](https://docs.github.com/en/copilot/concepts/agents/hooks)
- [GitHub Custom Agents and Subagent Orchestration](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-usage)
- [Cursor Agent Overview](https://cursor.com/docs/agent/overview)
- [Cursor Rules](https://docs.cursor.com/context/rules-for-ai)
- [Cursor Automations](https://prod.cursor.com/help/ai-features/automations)
- [OpenAI Model Guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Codex Use Cases](https://developers.openai.com/codex/use-cases)

Feature availability varies by product, plan, platform, and release. These references are comparison points, not requirements to copy another product's security or deployment model into Cockpit.
