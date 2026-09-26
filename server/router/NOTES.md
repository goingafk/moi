# Router notes

## TypeSafe System One

Verified on 2026-09-26 against TypeSafe's current `llms.txt`, API reference links, JavaScript SDK type index, and the Phase 6 memory-service scorer that has completed live Jev requests.

- Endpoint: `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>`.
- Request: `{ model: "jev-latest", state, questions }`. A Choice question has `{ type: "choice", instructions, criteria: Record<label, description> }`.
- Response: `{ answers: Record<id, ChoiceAnswer>, usage: { input_tokens, output_tokens } }`. A Choice answer carries `type`, `choice`, `probabilities`, and `confidence`.
- Retryable overload responses are HTTP 429 and 529. Routing makes at most one retry and shares one four-second deadline across both attempts.
- Routing sends only the first 800 message characters and a 300-character project summary. It asks `difficulty` and `kind` in the same request.

The router uses direct `fetch`, as memory-service does, rather than adding the TypeSafe SDK dependency. A valid Jev response records its token counts through `recordJevUsage`; usage-store failures do not discard a valid classification.

## Live catalog values

Read from the installed Claude Code 2.1.282 and Codex 0.153.4 catalogs on 2026-09-26:

- Claude aliases: `haiku`, `sonnet`, `opus`; additional concrete rows included `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, and `claude-sonnet-4-6`.
- Codex: `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`.

The default table therefore matches `luna` for cheap/trivial Codex work, `sol` for standard/medium work, and `astra` for top/hard work. Matchers are case-insensitive substrings and can be changed in Settings → Routing when provider names change.

No Ollama rows were configured in the local app settings during this catalog read. Phase 2 previously verified `qwen3.8:27b` with tools against `100.125.20.45:11434`; the router matches any tool-capable Ollama catalog row for trivial work and prefers a warm row.

## Model changes within a chat

- Claude Code calls the live Agent SDK query's `setModel(input.model)` before enqueueing the next message and updates its stored live model only after the setter succeeds.
- Codex includes `model` in each fresh `turn/start`; its app-server notification becomes the existing `model-change` notice. Steering an already-active turn stays on that turn's model, so a newly routed model takes effect on the next fresh turn.

## Persistence and tuning

- `routing-decisions.jsonl` keeps the first 120 normalized message characters, classification, scored/dropped candidates, decision, fallback/suggestion, and latency. The settings API shortens previews to 60 characters. It never stores credentials.
- `route-notices.json` keeps route notices per workspace path and session so reconnect snapshots can merge them with provider transcript events. Provider temporary-to-real session renames move these notices with the session.
- Decision-log rotation is deliberately not implemented in Phase 7. File growth is an operational tuning item.
- Selection knobs are the eligibility table and Claude reserve percentage. Task kind is logged and displayed but does not affect selection yet.
