# Fork plan — personal AI coding platform built on moi

This file is the source of truth for turning this fork of moi into a personal, remote-first, multi-model AI coding platform. It is written for a coding agent (Claude Code) working through it phase by phase. Read it fully before starting work, then follow the working rules at the bottom.

Owner: Arham (GitHub `goingafk`). This fork has left the upstream fork network and is personal. Upstream is `molefrog/moi`; we do not plan to send PRs back, but we keep upstream's architecture and conventions wherever possible so pulling in upstream fixes stays feasible.

---

## 1. Vision

One workspace, reachable from a laptop or a phone, running on my own servers, that lets me:

- Work with Claude Code (Claude subscription), Codex (ChatGPT subscription), and self-hosted models on Ollama (e.g. `qwen3.8-27b`, `bonsai2-27b`) from the same place.
- Choose between **Auto routed mode** (a router model, Jev or Laya, picks the agent/model for every request) and **Pick your model mode** (I choose manually from every available model).
- See how much usage I have left on each subscription, and have Auto mode spend usage intelligently.
- Keep every agent's own skills, plugins and MCP servers working.
- Open a real terminal in the browser to install CLIs and log in to Claude Code, Codex, etc.
- Share one memory across all agents and machines, scored and pruned by Jev or Laya.
- Do all of this safely over Tailscale, including from my phone as an installable app with notifications.

---

## 2. What moi already is (verified by reading the code)

Treat these as facts about the starting point. If you find any of them wrong, say so and update this section.

- **Stack:** Bun server (`server/`), React SPA (`client/`), shared types (`lib/`). Tests are `*.test.ts` next to the code (plus some in `server/test/`), run with `bun test`. Scripts: `bun run dev`, `bun run typecheck`, `bun run lint`, `bun run format:check`.
- **Agent conventions:** root `AGENTS.md` is canonical; every `CLAUDE.md` is a symlink to its sibling `AGENTS.md`. Rules live in `.agents/rules/` (product language, TypeScript, Tailwind, icons, animations, Bun). Skills live in `.agents/skills/` with symlinks in `.claude/skills/`. Frontend changes must follow `DESIGN.md` and `client/AGENTS.md`.
- **Harnesses:** agent backends live in `server/harness/<name>/`, each implementing the `Harness` type in `server/harness/types.ts` (sendMessage, interrupt, listSessions, listModels, mcpStatus, availability, startLogin, skillsDir, etc.). Registered in `server/harness/registry.ts`. Existing: `claude-code`, `codex`, `hermes`, `openclaw`. There is a provider-agnostic ACP layer in `server/harness/acp/`. `server/harness/README.md` documents the four message layers (wire → display → socket → client); adapters are the only code that sees wire types.
- **Skills provisioning copies, it does not symlink:** `installBundledSkills` (`server/skills-template.ts`) `cp -r`s moi's bundled skills into the harness's `skillsDir(workspaceRoot)` (default `.claude/skills`). The symlink convention in `AGENTS.md` applies to this repo's own `.agents/skills` → `.claude/skills`, not to workspaces. Phase 2 task 2 should decide explicitly between copying (current behaviour, versioned by `skill-version.ts`) and symlinking.
- **One agent per workspace:** the registry (`server/registry.ts`) holds one entry per folder path, and each entry has one harness `type`. This is the main thing Phase 2 changes. _(Phase 0: 19 non-test `harnessFor(` call sites in `server/`.)_
- **Models are live, not hardcoded:** Claude Code models come from the Claude CLI via the Agent SDK's `supportedModels()` (`server/harness/claude-code/models.ts`); Codex models come from Codex's model catalog plus config (`getCodexModels` in `server/harness/codex/client.ts`). The `Model` type in `lib/types.ts` already supports `group` and `providerId` for sectioned pickers.
- **Context envelope:** `lib/moi-context.ts` defines `MoiContext`, which rides along with every message and is rendered per harness. It has a `directives: string[]` field for one-shot instruction lines (used today by `lib/view-builder-directives.ts`). This is where memory digests get injected.
- **Settings:** app-wide user settings live in `settings.json` in the data dir, managed by `conf` with a JSON schema in `server/app-settings.ts` (currently only `autoUpdateSkills`). New keys need: `AppSettings` type in `lib/types.ts`, a schema entry with a default, and `API_UPDATABLE` if the UI may change them. Deployment config is separate (`server/app-config.ts`, `config.json` + `MOI_*` env vars).
- **Data dir:** `server/data-dir.ts` (`MOI_DATA_DIR` overrides). Global state is JSON files there.
- **Secrets:** per-workspace secrets exist (`docs/env-vars.md`, `server/workspace-env.ts`) — OS keychain via `Bun.secrets` with a `0600` file fallback. There is no global secret store yet.
- **Rate limits are received but not shown:** the Claude Agent SDK emits `rate_limit_event` with `rate_limit_info`. _(Corrected in Phase 0.)_ `server/harness/claude-code/adapter.ts` does not parse it: it forwards it to the client as a `rate-limit` `SystemNotice` with `info: unknown` (`lib/format.ts`), and the client deliberately drops that notice kind (`client/features/chat/messages/interleave-notices.ts`, "without a designed chat treatment yet"). So it reaches the browser, untyped and unrendered; nothing on the server keeps the latest value. Codex rate limits are not read at all (no `rateLimit` references in `server/harness/codex/`).
- **MCP:** moi shows MCP server status (connected / failed / needs-auth) per harness via `mcpStatus`, but does not configure MCP servers. Configuration stays native to each CLI.
- **Security:** the HTTP server binds `127.0.0.1` by default (`server/web.ts`, overridable with `HOST`); the control port's host is fixed to `127.0.0.1` (`CONTROL_HOST` in `server/constants.ts`), but its port is overridable with `MOI_CONTROL_PORT` (default 13059). **There was no authentication of any kind** _(Phase 1 added `server/auth.ts` for the HTTP port; see `docs/fork/remote-setup.md`)_ — on the HTTP port or the control port, so any local process can use the control port. Anyone who can reach port 13337 can drive an agent that runs shell commands. Agents also auto-approve everything: Claude Code via a `PreToolUse` allow hook (`server/harness/claude-code/permissions.ts`), Codex by accepting every supported permission request (workspace-write sandbox, network off).
- **Scratchpad:** built on tldraw (touch-capable).
- **No terminal, no PWA manifest, no service worker.** About 15 client files have some responsive classes; the app is desktop-first.
- **Self-update:** _(Corrected in Phase 0.)_ `server/update.ts` checks the npm registry for `moi-computer` (upstream's package) in the background (`GET /api/update`) and installs it only on an explicit action (the in-app update button → `POST /api/update`, or `moi update`). Source checkouts (git or no `dist/`) were already excluded; a global install (e.g. from `bun pm pack`) was not. Phase 0 gated all three entry points behind a deployment flag, `selfUpdate` in `config.json` / `MOI_SELF_UPDATE`, default off. `server/skill-update.ts` has no remote source: it copies the skills bundled with the running install into a workspace (`autoUpdateSkills` just runs that automatically), so it follows whatever install is running. `registry.json`'s `molefrog/moi/*` dependencies are resolved from the local bundle, not GitHub. `release.yml` publishes to npm as `moi-computer`, which would collide with upstream; after Phase 0 it is manual-dispatch only (no tag trigger). This fork installs from source with `bun link`.
- **License:** Elastic License 2.0. Personal use and modification are fine. Keep `LICENSE` and notices intact. It restricts offering the software to third parties as a hosted/managed service — relevant only if this ever becomes a product.

---

## 3. Decisions already made (do not relitigate without asking)

1. **No Hermes, no OpenRouter.** Hermes was judged too awkward to set up. Leave the `hermes` and `openclaw` harnesses in the code (don't delete working upstream code), but don't build on them and hide them from default UI where they add clutter.
2. **Local models run through Claude Code pointed at Ollama.** Ollama (v0.14+) exposes an Anthropic-compatible API at `http://<host>:11434`. A "local" session is the Claude Code harness with env overrides: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=ollama`, and model mapping (`ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_` / `_HAIKU_`, or `--model`). This keeps Claude Code's tools, skills, plugins and MCP for local models without writing a new harness.
3. **Jev is called directly** at TypeSafe's API (`https://api.typesafe.ai/v1/systemone`) with my own TypeSafe key (credits loaded). Not via OpenRouter, not via any harness.
4. **Laya** is my own model, self-hosted behind an OpenAI-compatible or Ollama endpoint. It is an alternative to Jev wherever Jev is used.
5. **Two model modes, user-selectable:** _Auto routed_ (always passes through Jev or Laya) and _Pick your model_ (manual). Global default in settings plus a per-session toggle in the composer.
6. **Pick your model shows everything:** all Claude Code models, all Codex models, and every model installed on each configured Ollama server, in one grouped picker.
7. **Memory is cross-agent and lives in its own service** (separate repo), exposed over MCP so any agent (Claude Code, Codex, Cline) can use it, with moi as one client. Global config: on/off toggle, scorer choice Jev or Laya, eviction threshold.
8. **Remote-first over Tailscale.** moi stays bound to localhost on the server; Tailscale Serve publishes it to my tailnet only. Never bind `0.0.0.0` or expose to the public internet.
9. **Mobile is for supervising**, not heavy editing: start tasks, get notified, approve/redirect, review diffs.
10. **Keep upstream conventions** (AGENTS.md rules, harness layering, tests next to code, Bun-native APIs, product language rules).

---

## 4. Target architecture

```
Phone / laptop browser (PWA)
        │  HTTPS, tailnet only (Tailscale Serve)
        ▼
moi server (Bun) on my server, bound to 127.0.0.1
  ├─ Auth middleware (Tailscale identity) ── rejects anyone not me
  ├─ Sessions (agent chosen per session, not per workspace)
  │    ├─ Claude Code harness ── Claude subscription
  │    ├─ Codex harness ──────── ChatGPT subscription
  │    └─ Claude Code harness + Ollama env ── Ollama :11434 (Qwen, Bonsai, …)
  ├─ Model catalog (merged: Claude + Codex + each Ollama server)
  ├─ Usage tracker (Claude rate-limit events, Codex rate-limit windows, Ollama load, Jev spend)
  ├─ Router (Auto mode) ── Jev or Laya classifies task; code picks model by headroom
  ├─ Web terminal (xterm.js ↔ PTY in tmux)
  └─ Memory client ──► Memory service (separate repo, SQLite, MCP + HTTP)
                            └─ Scorer: Jev (TypeSafe API) or Laya
```

---

## 5. Phases

Work one phase at a time, on its own branch, finishing with passing `bun test`, `bun run typecheck`, `bun run lint` and `bun run format:check`. At the end of each phase, summarise what changed, what was verified and how, and anything left uncertain, then stop and wait for me before starting the next phase.

### Phase 0 — Orientation and fork hygiene

Goal: a clean, running baseline that can't be clobbered by upstream.

Tasks:

1. `bun install`, run `bun test`, `bun run typecheck`, `bun run lint`. Record the baseline (any tests already failing are not ours to fix now — just list them).
2. Read `AGENTS.md`, `client/AGENTS.md`, `server/AGENTS.md`, `DESIGN.md`, `.agents/rules/*`, `server/harness/README.md`, `server/harness/claude-code/NOTES.md`, `server/harness/codex/NOTES.md`, `docs/env-vars.md`.
3. Update `package.json` `repository`, `homepage` and `bugs` to point at `github.com/goingafk/<fork name>`. Keep the license field and `LICENSE` file unchanged.
4. Audit `server/update.ts` and `server/skill-update.ts`. Make sure nothing auto-updates this install from upstream npm or upstream skills. Prefer a clear config flag (default off for this fork) over deleting code.
5. Add a short section to root `AGENTS.md` (not the `CLAUDE.md` symlink) pointing agents to this plan (`docs/fork/PLAN.md`) and stating the fork's decisions in two or three lines.
6. Correct anything in section 2 of this plan that turns out to be wrong.

Done when: baseline recorded, dev server runs, no upstream auto-update path, AGENTS.md points here.

### Phase 1 — Security for remote access

Goal: safe to use from any of my devices over Tailscale; unusable by anyone else.

Tasks:

1. Add auth middleware to the HTTP API **and** the WebSocket upgrade path. Use Tailscale Serve's identity headers (verify the exact header names in Tailscale's docs, e.g. `Tailscale-User-Login`). Allow only logins listed in a config value (e.g. `MOI_ALLOWED_USERS` / `config.json`). Trust identity headers only for requests arriving from `127.0.0.1` (i.e. via Tailscale Serve on the same host).
2. Keep a local-dev bypass that is explicit and only works on loopback without proxy headers (e.g. `MOI_AUTH=off`), so `bun run dev` on a laptop still works.
3. Refuse to start (or print a loud warning and require an explicit override) if `HOST` is set to a non-loopback address while auth is off.
4. Confirm the control port stays loopback-only.
5. Write `docs/fork/remote-setup.md`: running moi as a service on the server, `tailscale serve` setup (HTTPS, MagicDNS name), and how to add allowed users.
6. Tests: unauthenticated HTTP request → 401; unauthenticated WS upgrade → rejected; allowed identity → OK; disallowed identity → 403; bypass only on loopback.

Done when: from my phone on the tailnet I can open moi over HTTPS; from a device not on the tailnet, nothing is reachable; tests pass.

### Phase 2 — Multi-agent sessions and the unified model picker (manual mode)

Goal: in one workspace, I can open sessions on Claude, Codex, or any Ollama model, chosen from one picker.

Tasks:

1. **Move the agent choice from workspace to session.** Today `harnessFor(workspace)` decides the backend. Introduce a per-session agent binding (stored in per-user state in the data dir, following the "decide ownership before adding persistence" rule in AGENTS.md), with the workspace `type` becoming the _default_ for new sessions. Every place that dispatches through `harnessFor` must be reviewed: session listing, sending, interrupt, events, status snapshot, archive, MCP status. Session lists in the UI should merge sessions from all harnesses used in the workspace and label each with its agent.
2. **Skills per agent:** when a workspace gets a session on a new harness type, provision moi's skills into that harness's `skillsDir` (the provisioning path `moi init` already uses). Don't duplicate skill files; follow the existing symlink conventions.
3. **Ollama model discovery:** new module (e.g. `server/ollama/`) that, for each configured Ollama server:
   - lists installed models (`GET /api/tags`),
   - reads capabilities per model (`POST /api/show`; verify the capabilities field in current Ollama docs) and flags models without tool calling,
   - reads currently loaded models (`GET /api/ps`) for a "ready / cold" indicator.
     Cache briefly; refresh when the picker opens.
4. **Settings:** add Ollama servers to app settings (list of `{ name, baseUrl }`, default empty), editable in the settings UI. Example: `{ name: "homelab", baseUrl: "http://<tailscale-host>:11434" }`.
5. **Local agent profile:** a session bound to an Ollama model runs the Claude Code harness with env overrides (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=ollama`, model mapping). Known issues to handle, from Claude Code's issue tracker:
   - startup can hang fetching cloud MCP server lists when pointed at a local backend — find the setting or flag that avoids this and apply it for local sessions;
   - local models degrade badly when given hundreds of tool definitions — local sessions should use a lean MCP config (strict/allow-listed servers only), configurable in settings.
     Verify both against the installed Claude Code version rather than assuming.
6. **Unified picker:** merge Claude models, Codex models and each Ollama server's models into one list using `Model.group` headings ("Claude", "Codex", "Ollama — homelab", …). Each entry carries which agent runs it; picking an entry sets the session's agent + model. Grey out non-tool-capable Ollama models with a short explanation. Show the ready/cold dot for Ollama.
7. **Mode switch (manual only for now):** add the global setting `modelMode: "auto" | "manual"` (default `"manual"` until Phase 7 lands) and the per-session toggle in the composer. In this phase, Auto is visible but disabled with a "coming soon" state, or hidden — your call, but keep the setting shape final.
8. Tests: harness dispatch per session; picker merge and grouping; Ollama discovery with a fake server; env overrides applied only to local sessions.

Done when: in one workspace I can run a Claude session, a Codex session and a Qwen-on-Ollama session side by side, each using its own tools and skills, chosen from one grouped picker.

### Phase 3 — Permission modes

Goal: per session, I decide what an agent may do without asking, and approvals show up in the chat (and later on my phone).

Today every agent auto-approves everything (section 2, Security). That is acceptable for Claude and Codex, which I watch, but not for local models, which make more mistakes.

Tasks:

1. **Setting shape:** per-session `permissionMode: "auto" | "ask-risky" | "ask-all"`. `auto` is today's behaviour. Store it with the Phase 2 per-session agent binding (per-user state in the data dir). Global defaults per agent kind in app settings: Claude Code and Codex default to `auto`; Ollama/local sessions default to `ask-risky`. Toggle in the composer next to the model picker.
2. **Risk classifier:** a pure, harness-agnostic function (e.g. `server/permissions/classify.ts`) taking a normalised tool request (agent, tool name, shell command, target paths, cwd, workspace root) and returning `safe` or `risky` with a short reason. Built-in "risky" rules, each individually switchable:
   - **outside the project:** a shell command whose cwd, or any path argument, resolves (after `realpath`) outside the workspace root; any file write/edit outside it;
   - **deletes:** `rm`, `rmdir`, `unlink`, `git rm`, `find … -delete`, file-delete tools, and moves that overwrite;
   - **network:** `curl`, `wget`, `ssh`, `scp`, `rsync` to a remote, `nc`, package installs (`bun/npm/pnpm/yarn add|install`, `pip install`, `brew install`, `cargo install`), web fetch/search tools, and Codex network-permission requests;
   - **git that publishes or discards work:** `push`, any `--force`, `reset --hard`, `clean -f`, `checkout --`/`restore` of tracked files, `branch -D`, `rebase`, `commit --amend`, `stash drop|clear`;
   - **privilege and system:** `sudo`, `su`, `chmod`/`chown` outside the project, `kill`/`pkill`, `launchctl`, `systemctl`, `crontab`;
   - **sensitive files:** `.env*`, `~/.ssh`, `~/.claude`, `~/.codex`, shell rc files, the moi data dir;
   - **unparseable shell:** command substitution, `eval`, piping into `sh`/`bash`, or anything the parser can't classify → risky (fail closed). Use the existing `shell-quote` dependency for parsing.
3. **Configurable:** app settings hold `alwaysAsk` and `alwaysAllow` lists (command prefixes, tool names, path globs) plus the per-rule switches. `alwaysAsk` beats `alwaysAllow`; both beat built-in rules. Per-workspace overrides only if clearly needed (decide ownership first).
4. **Harness wiring:** verify each mechanism against the installed versions before coding and record it in the harness `NOTES.md`.
   - Claude Code: the `PreToolUse` hook (`claude-code/permissions.ts`) returns `allow` in `auto`, and defers to the `canUseTool` callback (or returns `ask`/`deny`) otherwise; `canUseTool` waits for the UI decision.
   - Codex: `permissions.ts` stops auto-accepting in ask modes; approval server requests are forwarded to the UI and answered with the user's decision. Choose `approvalPolicy` per mode.
   - A session waiting on a decision reports `requires-action`.
5. **Protocol and UI:** new socket messages for an approval request and response in `lib/types.ts`; pending requests are included in the status snapshot so they survive reconnects. Chat approval card: tool, command, paths, why it's risky; actions "Allow once", "Allow for this session", "Deny" (with an optional note to the agent). No timeout; interrupting the session cancels pending requests.
6. **Audit log:** every decision (request, classification, mode, answer, who) appended to a local file in the data dir.
7. Tests: classifier table tests (including path escapes via `..` and symlinks); per-harness wiring with fakes; reconnect with a pending approval; `auto` mode unchanged.

Phase 8 (mobile) push notifications depend on this phase.

Done when: a local session asks before `git push`, `rm -rf` or `curl`; a Claude session in `auto` behaves exactly as today; and I can approve or deny from the chat.

### Phase 4 — Web terminal

Goal: a terminal tab in the UI for installing CLIs and logging in to Claude Code, Codex, etc., on the server.

Tasks:

1. Server: spawn a PTY running the user's shell inside a named `tmux` session per terminal, so sessions survive disconnects (important on mobile). Check whether the installed Bun has native PTY support; if not, pick a maintained PTY package that works under Bun and prove it with a test before building UI.
2. Transport: WebSocket carrying input, output and resize events. Must go through the Phase 1 auth middleware. Never available without auth.
3. Client: xterm.js tab (fit addon, copy/paste, touch-friendly scrolling). Follow `DESIGN.md` for the chrome.
4. Terminal list: create, reattach, rename, kill.
5. Login helpers: document and, where practical, add buttons for remote-friendly login flows (Codex device-code login; Claude Code's URL + paste-code flow). Check what each CLI version actually supports. Wire these through the existing optional `startLogin` harness hook where it fits.
6. Tests: auth required; PTY round-trip; reattach after disconnect.

Done when: from my phone I can open a terminal, run `claude` or `codex` login flows, disconnect, reconnect and find the same session.

### Phase 5 — Usage tracking

Goal: one view showing how much usage is left per provider and when it resets.

Tasks:

1. **Claude:** `rate_limit_event` already reaches the client as a `rate-limit` notice (dropped at render time in `client/features/chat/messages/interleave-notices.ts`), so this is server-side work: retain the latest value per account and normalise it. Normalise `rate_limit_info` into a shared `UsageSnapshot` type (provider, window type, status, utilisation if present, resets at, observed at). Inspect real events and document the actual fields in `server/harness/claude-code/NOTES.md` — expect a coarse signal (status + reset time), not always a percentage.
2. **Codex:** read rate-limit windows from the Codex app server (verify method/notification names against the Codex version in use and document them in `server/harness/codex/NOTES.md`). Normalise into `UsageSnapshot`.
3. **Ollama:** report per-server availability and loaded models (no quota).
4. **Jev:** track spend locally from token counts × published price; show alongside the TypeSafe balance if an API for it exists (check; if not, just local spend).
5. Store latest snapshots in the data dir; broadcast updates to clients.
6. UI: a usage panel (and compact indicator in the header) with one bar per provider: used / remaining, window, reset time, freshness ("as of 3 min ago").
7. Tests: normalisation from recorded real payloads (commit fixtures), staleness handling.

Done when: I can see at a glance how much Claude and Codex usage I have left and when each resets.

### Phase 6 — Memory service (separate repo) and moi integration

Goal: one memory shared by every agent on every machine.

This phase creates a **new repository** (suggested name `memory-service`, Bun + TypeScript). Scaffold it separately; in this repo only build the client integration.

Memory service spec:

- **Storage:** SQLite via `bun:sqlite` in WAL mode (multiple agents write concurrently; JSON files would lose writes).
- **Entry fields:** `id`, `scope` (`global` | `project` | `session`), `projectKey`, `sessionId?`, `text`, `pinned`, `lastScore`, `lastScoredAt`, `createdAt`, `updatedAt`, `supersededBy?`, provenance (`agent`, `model`, `machine`).
- **Project identity:** normalised git remote URL, falling back to absolute path when there's no remote. This lets different machines with different paths agree on the project.
- **Scorer interface** (swappable; Jev and Laya both implement it):
  ```ts
  type ScoreResult = { value: number; confidence: number } // value 0..1
  type MemoryScorer = {
    id: 'jev' | 'laya'
    score(entryText: string, currentContext: string): Promise<ScoreResult>
    classifyAgainst(
      newText: string,
      existingText: string
    ): Promise<{ label: 'new' | 'duplicate' | 'contradicts'; confidence: number }>
  }
  ```
  Keep the state sent to the scorer small and specific — Jev's docs warn accuracy drops as irrelevant content grows. Jev cannot do arithmetic or date reasoning; all decay/threshold/recency maths lives in our code.
- **Jev scorer:** direct calls to TypeSafe's System One API. **Verify the request/response shapes against TypeSafe's current docs (their `llms.txt` / API reference / official JS SDK `@typesafe-ai/sdk`) before writing it — an earlier draft guessed the shape.** Prefer the official SDK if it works under Bun.
- **Laya scorer:** calls Laya's endpoint with a prompt that forces a number / one-of-three label only; parse strictly; treat parse failures as errors, not scores.
- **Write path:** on `remember`, find similar existing entries in the same scope/project, run `classifyAgainst`: duplicates merge, contradictions supersede the older entry (kept in history), new entries are stored and scored.
- **Eviction:** periodic re-score against current context; entries below the threshold are evicted unless pinned. Failed scoring keeps the last score (never evict because an API call failed).
- **Fallback:** if the configured scorer fails, fall back to the other one; if both fail, skip scoring and keep everything.
- **Interfaces:** an MCP server with tools `remember`, `recall`, `pin`, `forget`, plus a small HTTP API for moi. Same auth approach as moi (tailnet only, identity allow-list).
- **Config:** global `enabled`, `scorer: 'jev' | 'laya'`, `threshold` (default 0.3), Laya endpoint, TypeSafe key in the OS keychain (not in files).
- **Inspector:** HTTP endpoints to list/edit/pin/delete entries with scores and provenance (UI lives in moi).

moi integration (this repo):

1. Settings: memory service URL, and the global memory toggle/scorer/threshold surfaced from the service.
2. Before each send, fetch a digest (global + current project + current session) and push it into `MoiContext.directives`, formatted as short, plain lines, capped (e.g. 12 entries, highest score first). Skip entirely when memory is off or the service is unreachable (never block a send).
3. A `moi memory add "..."` CLI command so agents in moi can save facts; also document registering the memory service's MCP server in Claude Code, Codex and Cline.
4. Memory inspector view: list entries with score, scope, agent/provenance; edit, pin, delete.
5. Tests with a fake memory service.

Done when: a fact saved by a Codex session shows up in a Claude session in the same project (and from another machine), and low-relevance facts disappear over time unless pinned.

### Phase 7 — Router and Auto routed mode

Goal: in Auto mode, every request goes through Jev or Laya and lands on a sensible model.

Tasks:

1. **Task classification (model's job):** Jev/Laya answers two `Choice` questions from the user's message plus a short project summary: difficulty (`trivial` | `medium` | `hard`) and kind (`ui-scaffold` | `refactor` | `debug` | `tests` | `docs` | `other`).
2. **Model selection (code's job):**
   - eligibility table: which catalog entries are allowed per difficulty (configurable; e.g. trivial → local or cheapest, hard → strongest Claude/Codex models);
   - among eligible, rank by headroom from Phase 5, preferring **usage that is unused and about to reset** (use-it-or-lose-it), then local models as the free default for trivial work;
   - skip anything unavailable (rate-limited, server down, model cold if a warm alternative exists).
3. **Transparency:** each Auto-routed message shows the chosen model and a one-line reason ("Codex — refactor; OpenAI usage resets in 40 min"). One click to override for the rest of the session (switches that session to manual with the chosen model).
4. **Fallbacks:** Jev fails → Laya; both fail → last-used model, with a visible notice. Never fail the user's message because routing failed.
5. **Continuity:** switching agents mid-session keeps context through the memory service digest; note in the UI when a session changes agent.
6. Log every routing decision (inputs, classification, chosen model, reason) to a local file for later tuning.
7. Tests: selection logic with fixture usage snapshots; fallback chain; override behaviour.

Done when: Auto mode routes trivial tasks to local models, uses expiring subscription usage first, reserves scarce Claude usage for hard tasks, and always explains itself.

### Phase 8 — Mobile

Goal: installable, usable phone experience for supervising agents.

Tasks:

1. PWA: web app manifest, icons, service worker (app shell caching only — never cache API responses with private data), full-screen standalone display.
2. Push notifications (Web Push with VAPID keys stored as secrets) when a session enters `requires-action` and when a task finishes. Depends on Phase 3: until permission modes exist, agents auto-approve everything, so `requires-action` almost never happens and there is little to notify about. Settings to toggle each. Verify iOS behaviour (home-screen web apps only).
3. Phone layout: chat-first; session list as a drawer; large approve/reject controls for `requires-action`; readable diff view; usage indicator. Follow `DESIGN.md`.
4. Voice input for the composer (browser speech recognition where available).
5. Reconnect behaviour: confirm the status snapshot resync works over flaky mobile connections; add a visible "reconnecting" state.

Done when: moi is installed on my phone's home screen, buzzes when an agent needs me, and I can approve and review from the phone comfortably.

### Phase 9 — Later (do not start without asking)

- Multiple servers as environments: register servers, choose one per project, show which server each session runs on.
- Per-project containers for isolation and reproducible toolchains (Flutter, Godot, Node, …).
- Cross-provider cost dashboard (per session and per day) using the usage data from Phase 5.
- Connector skills with `requiredEnv` templates for GitHub and Linear.
- Homelab widget pulling Prometheus/Grafana data.
- Jev vs Laya side-by-side comparison mode for scoring and routing, with logged disagreements, to decide whether Laya can replace paid Jev calls.

---

## 6. Working rules for the agent

1. **Follow upstream conventions.** Read and obey `AGENTS.md`, the relevant `.agents/rules/*` files and `DESIGN.md` before editing matching files. Bun-native APIs, no `any`, `type` over `interface`, Tailwind only, `@tabler/icons-react` only, product-language rules for all UI copy.
2. **Verify external APIs before coding against them.** For TypeSafe/Jev, Ollama, Codex app-server rate limits, Claude `rate_limit_info`, Tailscale identity headers and PTY support under Bun: read current docs or capture real traffic first, then record what you found in the relevant `NOTES.md` or `docs/fork/*.md`. Do not invent request shapes. If something can't be verified, say so explicitly in your phase summary.
3. **Respect the harness layering.** Wire types stay inside adapters; shared contracts stay in `lib/`. No harness folder imports from a sibling harness.
4. **Tests next to code** (`*.test.ts`), using the existing seams (e.g. `setAppSettingsDir`, `MOI_DATA_DIR`) rather than touching my real data dir.
5. **Secrets never in the repo or in logs.** Use the keychain-backed stores. Never print API keys.
6. **Never bind to a public interface** or add a way to reach moi without auth once Phase 1 lands.
7. **Small, reviewable commits**, one branch per phase, following `.agents/rules/pull-requests.md` if opening PRs on my fork.
8. **Stop and ask** before: deleting upstream features, changing the license, destructive migrations of existing data files, adding heavy new dependencies, or anything that changes security posture.
9. **End every phase with a summary:** what changed, how it was verified (commands + results), open questions, and anything in this plan that turned out to be wrong.
