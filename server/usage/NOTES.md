# Usage tracking notes

## Jev

Verified from TypeSafe's official API and model documentation on 2026-09-25:

- `POST /v1/systemone` returns `usage.input_tokens` and
  `usage.output_tokens` for every request.
- Jev 1.13 costs $0.042 per million input tokens; output tokens are free.
- The documented API surface exposes evaluation and model listing. It does not
  document an account-balance endpoint, so moi does not guess one or probe an
  undocumented route.

There are no Jev calls in moi before the memory and router phases. Phase 5
therefore provides `recordJevUsage(inputTokens, outputTokens)` and persisted
local-spend aggregation for those callers, while the UI shows “No local
requests yet” until one exists. If TypeSafe changes the published price, update
the constant prospectively; persisted token totals let the displayed aggregate
be recalculated, but historical price periods would need a ledger before
automatic repricing is safe.

Sources:

- https://docs.typesafe.ai/api.md
- https://docs.typesafe.ai/models.md
