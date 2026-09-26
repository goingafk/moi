# Phase 7 — Router and Auto routed mode: design and implementation plan

Written for the coding agent (Codex) implementing Phase 7. Read `docs/fork/PLAN.md` (Phase 7 and §6 working rules), root `AGENTS.md`, `server/AGENTS.md`, `client/AGENTS.md`, `DESIGN.md` and the `.agents/rules/*` files before editing. This file records owner-approved design decisions; do not relitigate them without asking.

Branch: `fork/phase-7-router` (from `fork/phase-6-memory`). Finish with passing `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run build:client`, then update the Phase 7 section of `docs/fork/PROGRESS.md`.

---

## 1. Owner decisions (approved 2026-09-26)

1. **Routing cadence — first message cross-agent, later messages same-agent.** An Auto chat's first message is routed across every agent (Claude, Codex, Ollama). Every later message is classified again, but may only change the _model within the chat's bound agent_ (Phase 2's "a chat cannot change agents" rule stays). When a different agent would clearly fit better, the send still goes to the current agent and the routing notice offers **Continue in <agent>**, which opens a new chat on that agent/model with the message prefilled. Context carries over through the Phase 6 memory digest. This replaces PLAN task 5's "switching agents mid-session".
2. **Jev key — moi's own keychain secret.** moi calls TypeSafe directly (PLAN decision 3). Add a small global secret store (Bun.secrets keychain with a `0600` file fallback, same mechanism as `server/workspace-env.ts`). The key is entered once in Settings → Routing. Routing must not depend on memory-service.
3. **Default eligibility table — local-first ladder** (editable in settings):
   - `trivial` → Ollama (tool-capable, warm preferred) › Claude Haiku › Codex mini
   - `medium` → Claude Sonnet ⇄ Codex standard
   - `hard` → Claude Opus ⇄ Codex top model
   - **Claude reserve:** skip Claude for `trivial`/`medium` when its window is > 70% used (or its status is `warning`/`exhausted`).
   - Tie-break within a tier: most unused share that resets soonest (use-it-or-lose-it).
4. **Architecture — route on the server at the send point** (not client pre-routing, not a pseudo-harness).
5. Task kind (`ui-scaffold | refactor | debug | tests | docs | other`) is classified, shown in the reason and logged, but does **not** affect selection in this phase (kept for Phase 9 tuning).

---

## 2. Design

### 2.1 Data flow (chat send)

`server/web.ts` chat handler (around line 266) currently calls `resolveSessionRun(...)` then `withMemoryDigest(...)` then `harness.sendMessage(...)`. New flow:

```
chat message arrives
  └─ routing = sessionConfig.routing ?? (isNew ? data.routing ?? settings.modelMode : 'manual')
  └─ if routing === 'auto':
        decision = await routeMessage({ workspace, sessionId, isNew, content, boundAgent })
        // never throws; always returns a usable { agent, model } (see fallbacks)
        requestedAgent = decision.agent; requestedModel = decision.model
        broadcast a 'route' notice into the chat (see 2.5)
  └─ resolveSessionRun(workspace, sessionId, requestedAgent, requestedModel, permissionMode)
  └─ saveSessionConfig(..., { routing: 'auto', model: decision.model })  // auto chats only
  └─ withMemoryDigest(...) → harness.sendMessage(...)   // unchanged
```

`routeMessage` for a follow-up (chat already bound) only considers catalog rows whose agent equals the bound agent (`sameSessionAgent`). It additionally computes the best cross-agent row; if that row is in a strictly better tier position for the classification, the decision carries `suggestion: { agent, model, label }` for the **Continue in** action.

### 2.2 `server/router/` modules

| File                                      | Purpose                                                                                                                                                            | Depends on                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `types.ts`                                | `Difficulty`, `TaskKind`, `Classification`, `RouteClassifier`, `RouteDecision`, `EligibilityTable` (shared shapes go in `lib/types.ts` when the client needs them) | —                                                  |
| `jev.ts`                                  | Jev classifier: one TypeSafe System One request with two `choice` questions                                                                                        | `secrets.ts`, `recordJevUsage`                     |
| `laya.ts`                                 | Laya classifier: OpenAI-compatible chat completion, strict parse                                                                                                   | app settings                                       |
| `classify.ts`                             | Chain: primary (setting) → other → throw `RouteClassifierError`                                                                                                    | `jev.ts`, `laya.ts`                                |
| `project-summary.ts`                      | One cached line: workspace name + first paragraph of README or `package.json` description, ≤ 300 chars                                                             | fs                                                 |
| `select.ts`                               | **Pure** selection: `(classification, catalog, snapshots, table, opts, now) → Selection \| null`                                                                   | —                                                  |
| `log.ts`                                  | Append JSONL decisions to `DATA_DIR/routing-decisions.jsonl` (test seam: `setRoutingLogPath`)                                                                      | data-dir                                           |
| `index.ts`                                | `routeMessage(...)`: classify → select → fallbacks → log → decision                                                                                                | all above, `listModelCatalog`, `getUsageSnapshots` |
| `secrets.ts` (or `server/app-secrets.ts`) | Global secret store: `getAppSecret/setAppSecret/deleteAppSecret/hasAppSecret` for `typesafe-api-key`                                                               | Bun.secrets                                        |

No harness folder imports `server/router/`; the router only reads the catalog and usage store (PLAN §6.3).

### 2.3 Classification (model's job)

**Verify the TypeSafe request/response shapes against https://docs.typesafe.ai/api.md before coding** (PLAN §6.2). The reference implementation that already works live is `~/Documents/memory-service/src/scorers/jev.ts` (same endpoint, auth, retry on 429/529, usage block). Port its `ask()` logic; do not import across repos.

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, model `jev-latest`, timeout **4 s total** for routing (no retries beyond one 429/529 backoff within the budget).
- One request, two questions:
  - `difficulty`: `{ type: 'choice', instructions, criteria: { trivial, medium, hard } }` with a one-sentence description per label (e.g. trivial = "a one-line change, a lookup, a rename, a quick question"; hard = "multi-file design, subtle debugging, architecture").
  - `kind`: `{ type: 'choice', instructions, criteria: { 'ui-scaffold', refactor, debug, tests, docs, other } }`.
- `state`: `{ message: <first 800 chars>, project: <summary line> }`. Keep it small (Jev accuracy drops with irrelevant state). No history, no file contents.
- Output: `{ difficulty, kind, confidence: min(two confidences), classifier: 'jev' | 'laya', inputTokens, outputTokens }`.
- Call `recordJevUsage(input, output)` from `server/usage` after every Jev response (the Phase 5 hook, currently unused).
- Low confidence (< 0.5) on difficulty → treat as `medium`, note it in the reason.
- **Laya:** `POST {baseUrl}/v1/chat/completions` with `{ model, messages, temperature: 0 }`; the prompt demands exactly `difficulty=<label> kind=<label>`; parse with a strict regex against the allowed labels; any mismatch is an error, never a guess. Built and tested against a fake server (Laya is not deployed yet, as in Phase 6).

### 2.4 Selection (code's job) — `select.ts`

Inputs: classification, `CatalogModel[]` (from `listModelCatalog(ws)`), `UsageSnapshot[]` (from `getUsageSnapshots()`, with `stale` computed), the eligibility table, `{ restrictToAgent?: SessionAgent }`, `now`.

**Eligibility table** (app setting `routing.table`, default below). Each tier is an ordered list of matchers; order = preference rank before headroom is applied.

```ts
type RouteMatcher = { agent: 'claude-code' | 'codex' | 'ollama'; match?: string } // match: case-insensitive substring of CatalogModel.value; omitted = any
type EligibilityTable = Record<Difficulty, RouteMatcher[][]> // tier → ordered groups; rows in one group compete on headroom
```

Default (verify real model values from the live catalog — `GET /api/workspaces/:id/models` or `listModelCatalog` — and adjust the `match` strings; record the values found in `server/router/NOTES.md`):

```ts
trivial: [[{ agent: 'ollama' }], [{ agent: 'claude-code', match: 'haiku' }, { agent: 'codex', match: 'mini' }]],
medium:  [[{ agent: 'claude-code', match: 'sonnet' }, { agent: 'codex', match: '<standard codex model>' }]],
hard:    [[{ agent: 'claude-code', match: 'opus' },   { agent: 'codex', match: '<top codex model>' }]],
```

Algorithm:

1. Candidate rows = catalog rows matching a matcher in the tier, excluding rows with `disabledReason`, and (follow-ups) rows whose agent ≠ `restrictToAgent`.
2. Drop unavailable rows:
   - Claude/Codex: provider snapshot status `exhausted` or `unavailable` (non-stale). Unknown/stale ⇒ keep, headroom neutral.
   - Ollama: server snapshot `unavailable`; a cold row (`ready === false`) is dropped when a warm row exists in the same group.
3. Claude reserve: for `trivial`/`medium`, drop Claude rows when Claude's usage is `usedPercent > routing.claudeReservePercent` (default 70) or status is `warning`.
4. Walk groups in order; the first group with any candidate wins. Within it, rank by headroom score (highest wins, ties → group order):
   - quota rows: `remaining = 100 - usedPercent` (use the most constrained non-stale window of that provider); `urgency = 1 + 1 / max(hoursToReset, 0.25)`; `score = remaining * urgency`.
   - unknown/stale usage: `score = 50`.
   - Ollama rows: `score = 1000` (free; warm beats cold via step 2).
5. If every tier group is empty, retry with the **next harder tier**, then the next easier; if still nothing → return `null` (caller falls back).
6. Return `{ row, reason }`. Reason is one short line built by code, e.g. `Codex · refactor, medium · OpenAI usage resets in 40 min`, `Qwen on homelab · trivial · local and warm`, `Opus · hard · Claude 35% used`.

All maths (percent, hours, thresholds) lives here, never in the classifier.

### 2.5 Fallbacks (never fail a send)

`routeMessage` wraps everything in try/catch:

1. Classifier chain fails (both Jev and Laya, or no key and no Laya URL) → **last routed model** for this workspace (read the last matching line from the log, or keep an in-memory map `workspacePath → {agent, model}` seeded from the log) → for follow-ups, the chat's current model → workspace default agent with no model. Notice shows `Routing unavailable — used <model> (last used)`.
2. Selection returns `null` → same fallback, reason `No eligible model is available`.
3. Chosen row fails `resolveSessionRun` (e.g. Ollama model vanished) → retry once with the fallback decision; only then surface the existing error path.

### 2.6 Per-chat state and override

- `SessionConfig` (`lib/types.ts`, `server/session-config.ts` `clean`/`isEmpty`/`saveSessionConfig`) gains `routing?: 'auto' | 'manual'`. Missing ⇒ `manual` for existing chats (no migration).
- Chat client message (`lib/types.ts` ~line 275) gains optional `routing?: 'auto' | 'manual'`, honoured only when `isNew`. New chats default to the global `modelMode` (already in settings, default stays `manual`).
- **Override:** choosing a model in the picker for an Auto chat, or clicking **Use this model** on a route notice, saves `{ routing: 'manual', model }`. It never changes the agent (switching agent still starts a new chat, as today).
- **Continue in <agent>:** client starts a new chat with `agent`/`model` from the suggestion, `routing: 'manual'`, and prefills the composer with the triggering message (user presses send). Show a small "Continued from <chat title>" line is **not** required.

### 2.7 Transparency — route notice

- Add a `SystemNotice` variant in `lib/format.ts`: `{ id; kind: 'route'; at; agent: SessionAgent; model: string; label: string; reason: string; classification?: { difficulty; kind; classifier } ; fallback?: boolean; suggestion?: { agent; model; label } }`.
- Broadcast it through the same path other notices use (check how `rate-limit`/`model-change` notices reach the client — `broadcast(workspaceId, …)` / the harness event stream) so it survives the status snapshot and reconnects. If notices are only persisted by harness transcripts, keep route notices in a small per-session in-memory + data-dir store and merge them in the snapshot; document the choice.
- Render in `client/features/chat/messages/` (see `interleave-notices.ts`, which currently drops unknown kinds): one compact muted row above the assistant turn — model label, reason, and actions **Use this model** and (when present) **Continue in <agent>**. Follow `DESIGN.md`, Tailwind rules, `@tabler/icons-react` (e.g. `IconRoute` 12/1.75), product language (sentence case, "chat", no "successfully").
- When a follow-up changes the model within the agent, the existing `model-change` notice may also appear; do not duplicate — the route notice is enough (suppress the adjacent `model-change` only if trivial, otherwise leave it).

### 2.8 Composer and settings UI

- **Composer** (`client/features/chat/composer/ModelPicker.tsx`, `useWorkspaceComposerState.tsx`, `catalog-selection.ts`): add an **Auto** entry at the top of the picker. Selected ⇒ chat is `routing: 'auto'`; the trigger shows `Auto · <last routed model>` (or `Auto` before the first send). Picking any model ⇒ manual. Phase 2 hid Auto; un-hide it. Auto is disabled with a tooltip "Add a TypeSafe key or Laya endpoint in Settings → Routing" when neither classifier is configured.
- **Settings → Routing** (new `client/features/settings/RoutingSettings.tsx`, registered like `MemorySettings.tsx` in `WorkspaceSettingsDialog.tsx`/`SettingsLayout.tsx`):
  - Default mode for new chats (`modelMode`: Manual / Auto).
  - Classifier: Jev / Laya (primary; the other is the fallback).
  - TypeSafe key: write-only field (Save / Remove), shows "Key saved" state only — never returns the key to the browser.
  - Laya: base URL + model name.
  - Claude reserve percent (number, 0–100).
  - Eligibility table: per tier, the ordered groups as editable rows (agent select + match text). Keep it plain; a "Reset to defaults" action.
  - Recent decisions: last 20 log lines (time, message preview ≤ 60 chars, classification, chosen model, reason, fallback flag).

### 2.9 Settings and API

- `lib/types.ts` `AppSettings` gains `routing: { classifier: 'jev' | 'laya'; laya: { baseUrl: string; model: string } | null; claudeReservePercent: number; table: EligibilityTable }`. Schema + default in `server/app-settings.ts`; add `'routing'` to `API_UPDATABLE`; validate Laya URL as http(s) and matchers' agents against the enum.
- Routes (all through `server/auth.ts`, like `/api/memory/*`):
  - `GET /api/routing/status` → `{ jevKeySet: boolean; layaConfigured: boolean }`
  - `PUT /api/routing/typesafe-key` `{ key }` / `DELETE` same path. Never log the key; never echo it.
  - `GET /api/routing/decisions?limit=20` → recent log entries (message preview only).
- Client hooks via React Query in `client/features/settings/api.ts` (follow the memory hooks' pattern).

### 2.10 Decision log

`DATA_DIR/routing-decisions.jsonl`, one line per routed send:

```json
{
  "at": "…",
  "workspacePath": "…",
  "sessionId": "…",
  "isNew": true,
  "messagePreview": "first 120 chars",
  "classification": {
    "difficulty": "medium",
    "kind": "refactor",
    "confidence": 0.82,
    "classifier": "jev"
  },
  "candidates": [{ "selectionId": "…", "score": 61.2, "dropped": null }],
  "chosen": { "agent": { "type": "codex" }, "model": "…" },
  "reason": "…",
  "fallback": null,
  "suggestion": null,
  "latencyMs": 740
}
```

No secrets, no full message text. Rotate nothing in this phase (note size growth as an open item).

---

## 3. Implementation plan (tasks, in order)

Use TDD where the unit is pure. Commit after each task with a behaviour-describing message. Tests go next to code (`*.test.ts`) and use the existing seams (`setAppSettingsDir`, `setSessionConfigPath`, `MOI_DATA_DIR`, fake `fetch`) — never the real data dir.

**Task 1 — Types and settings.** Add `Difficulty`, `TaskKind`, `RouteMatcher`, `EligibilityTable`, `RoutingSettings`, the `routing` field on `AppSettings`, `SessionConfig.routing`, the chat-message `routing` field, and the `route` `SystemNotice`. Schema/default/`API_UPDATABLE` in `app-settings.ts`; `clean`/`isEmpty`/patch handling in `session-config.ts`. Tests: settings default + validation rejects bad agent/URL; session config round-trips `routing` and clears to empty.

**Task 2 — Global secret store.** Extract or mirror the keychain/file backend from `workspace-env.ts` into `server/app-secrets.ts` (service `com.molefrog.moi`, name `app:typesafe-api-key`; file fallback `DATA_DIR/app-secrets.json` at `0600`). Respect `setSecretStoreBackend` for tests. Tests: set/get/delete via file backend; file mode is `0600`.

**Task 3 — Selection (pure).** `server/router/select.ts` per §2.4. Fixture-driven table tests (`server/router/fixtures/`: catalog rows + usage snapshots): trivial → warm Ollama; trivial with Ollama down → Haiku/mini by headroom; cold Ollama only → still chosen; medium with Claude 80% used → Codex; medium with Claude 30% and Codex resetting in 20 min with 60% left → Codex (use-it-or-lose-it); hard → Opus vs Codex by headroom; exhausted provider skipped; stale snapshot treated neutral; empty tier escalates; nothing eligible → `null`; `restrictToAgent` limits rows and still yields a cross-agent `suggestion`; reason strings.

**Task 4 — Classifiers.** `jev.ts`, `laya.ts`, `classify.ts`, `project-summary.ts`. Verify TypeSafe docs first; write findings to `server/router/NOTES.md`. Tests with fake fetch: exact request body (two questions, small state), response parse, 429 backoff within budget, timeout → error, mistyped answer → error, `recordJevUsage` called with token counts, low confidence → medium; Laya strict parse accepts only exact labels; chain order follows setting and falls through.

**Task 5 — `routeMessage` + log + fallbacks.** `server/router/index.ts`, `log.ts`. Tests: happy path logs one line with no key/full text; classifier failure → last routed model with `fallback` reason; no history → workspace default; selection `null` → fallback; follow-up restricted to bound agent; never throws (inject a throwing catalog).

**Task 6 — Send-path wiring.** `server/web.ts` chat handler per §2.1; save `routing`/`model` for auto chats; broadcast the route notice; retry once with fallback if `resolveSessionRun` rejects the routed choice. Model change within agent: verify Claude (live model setter) and Codex (per-turn model, emits `model-change`) actually switch on the next turn; record in `server/router/NOTES.md`. Tests (extend existing web/session tests or add `server/router/wiring.test.ts` with fake harness): manual chats untouched (no classifier call); auto new chat binds the routed agent; auto follow-up never changes agent; override to manual stops routing.

**Task 7 — Routing API.** `/api/routing/status`, `typesafe-key` PUT/DELETE, `decisions`. Tests: auth required (reuse the auth test harness pattern), key never appears in any response, decisions limited and previewed.

**Task 8 — Route notice UI.** Server notice persistence/snapshot per §2.7, client rendering, **Use this model** and **Continue in** actions. Tests: notice survives snapshot/reconnect; `interleave-notices` keeps `route`; action handlers produce the right session-config patch / new-chat draft (pure helpers tested).

**Task 9 — Composer Auto entry.** Picker entry, trigger label, disabled state, new-chat `routing` from global default. Tests for `catalog-selection.ts`/picker helpers.

**Task 10 — Settings → Routing page.** Per §2.8. Pure formatting helpers tested; manual check in a browser.

**Task 11 — Docs and progress.** `server/router/NOTES.md` (verified API shapes, real catalog model values, tuning knobs); `docs/fork/router.md` (user-facing: how Auto works, settings, reading the log); mention `server/router/` in `server/AGENTS.md`; update PLAN §2 for `modelMode` now live and PLAN Phase 7 task 5 to reflect decision 1; update `PROGRESS.md` Phase 7 (summary, verification with test counts, decisions, open items).

**Task 12 — Verification.** Full suite + typecheck + lint (expect the same 9 pre-existing warnings) + format + client build. Live check with isolated data (`MOI_DATA_DIR` temp dir, production build): save a TypeSafe key, send a trivial prompt in an Auto chat → routes to the Ollama model at `100.125.20.45:11434` with a reason; send a hard prompt in a new Auto chat → Opus or top Codex; remove the key and Laya → send still succeeds with the fallback notice; override → chat stays on the chosen model. Confirm the Jev row in Settings → Usage increases. Remove temp data afterwards. Note in PROGRESS anything not verifiable (e.g. Laya live).

---

## 4. Done when (from PLAN Phase 7, adjusted by decision 1)

Auto mode routes trivial tasks to local models, uses expiring subscription usage first, reserves scarce Claude usage for hard tasks, never fails a send because routing failed, and every routed message shows its model and a one-line reason with a one-click override.

## 5. Known risks to call out in the PR

- Routing adds up to ~4 s before an Auto send (Jev round trip) on top of memory's 800 ms. Log `latencyMs`; consider running the digest fetch in parallel with routing.
- Claude usage is coarse (status + reset, often no percent); the reserve rule relies on `warning` status when the percent is missing.
- Catalog `match` substrings depend on live model IDs that providers rename; a tier that matches nothing escalates silently — surface "no rows match" in Settings → Routing.
