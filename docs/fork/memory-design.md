# Phase 6 design: shared memory

The design as built. The service lives in its own repo (`~/Documents/memory-service`; see its `README.md` and `NOTES.md`). The moi integration is described in `memory.md`.

## Decisions (owner-approved, 2026-09-25/26)

| Question                                  | Decision                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where the service runs                    | Separate repo, deployed on the moi LXC as its own systemd service, bound to the LXC's Tailscale IPv4                                                               |
| Finding similar entries                   | Hybrid: SQLite FTS5 (BM25) always, plus Ollama embeddings when configured and reachable; fused by rank                                                             |
| What "current context" means for eviction | A rolling log of recent work per project (the last 20 digest messages); the hourly sweep scores entries against the last 5. The digest itself never calls a scorer |
| Laya                                      | Interface and strict parser built now against an OpenAI-compatible endpoint, tested with fakes; Jev is the default                                                 |
| Service auth                              | Device-IP allow-list, as in moi's direct-tailnet mode. No secrets in agent MCP configs; provenance is self-declared                                                |
| Scoring maths                             | Chosen from published systems (below), not invented                                                                                                                |

## Scoring model

Stored per entry: `importance` (Jev once at write), `relevance`, `relevanceConfidence`, `relevanceScoredAt` (sweep), `useCount`, `lastUsedAt`, `status` (`active` | `superseded` | `evicted`), and `supersededBy`.

- **Candidate search:** BM25 and cosine lists fused with Reciprocal Rank Fusion (k = 60).
- **Write path:** the top 3 candidates in the same scope and project go through `classifyAgainst` (Jev `choice`, one request per pair). The best-ranked verdict at confidence ≥ 0.7 wins: a duplicate reinforces (or revives) the old entry; a contradiction supersedes it and keeps it in history. If every call fails, the fact is stored as new.
- **Activation:** ACT-R base level, `B = ln(n/(1−d)) − d·ln(L)`, with d = 0.5, n = uses + 1, L = days alive (≥ 1).
- **Uses:** a restated fact, an explicit `recall` hit, a pin, or an edit. Appearing in a digest is not a use.
- **Digest:** pinned first, then RRF over similarity to the message, stored relevance (unscored = median) and activation, with equal weight. Capped at 12 entries. It records the message in the context log.
- **Eviction:** entries are archived, not deleted. An entry is archived only when it is active, unpinned, at least 7 days old, and relevance was scored at confidence ≥ 0.6 and fell below the threshold (default 0.3), and B < −1 (one use and about 30 days old). Session entries archive after 7 idle days. A failed or low-confidence score keeps the previous value and never evicts.
- **Reactivation:** a duplicate `remember` or an explicit `recall` brings an archived entry back. `recall` searches archived entries only when fewer than 3 active entries match.
- **Tuning:** every decision is appended to the service's `decisions.jsonl`.

The thresholds (0.7 and 0.6 confidence floors, B < −1, 7-day grace) are judgement defaults, not research findings.

## Research: how other systems score memory

| System                               | Ranking                                                                                        | Dedup / contradiction                                                    | Forgetting                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Generative Agents (Park et al. 2023) | recency (0.995 per hour) + LLM importance (1–10) + cosine relevance, min-max scaled, weights 1 | —                                                                        | none                                                                         |
| Mem0 (2025)                          | vector similarity                                                                              | 10 similar memories; one LLM call picks ADD / UPDATE / DELETE / NOOP     | DELETE on contradiction only                                                 |
| Zep / Graphiti (2025)                | cosine + BM25 + graph BFS, RRF / MMR / cross-encoder rerank                                    | LLM compares related facts; contradictions get `t_invalid` (bi-temporal) | none; history kept                                                           |
| A-MEM (2025)                         | cosine top-k (10)                                                                              | LLM links and evolves notes                                              | none                                                                         |
| Letta / MemGPT                       | agent searches archival memory                                                                 | agent self-edits                                                         | no decay                                                                     |
| LangMem                              | similarity + importance + strength (recency/frequency)                                         | consolidate or invalidate                                                | left to the app                                                              |
| MemoryBank (2023)                    | —                                                                                              | —                                                                        | Ebbinghaus `R = e^(−t/S)`, S + 1 per recall                                  |
| ACT-R-based agent memory             | `B = ln(Σ t_j^−d)`, d = 0.5                                                                    | —                                                                        | archive below a stricter eviction threshold; reinforce on use, not retrieval |
| CAMeR (2026)                         | 0.6 cosine + 0.4 keyword Jaccard                                                               | —                                                                        | pure exponential decay collapses over long runs                              |
| Hybrid search generally              | RRF k = 60 (Cormack 2009), the default in Elasticsearch, OpenSearch and Weaviate               |                                                                          |                                                                              |

Sources:

- Generative Agents: <https://arxiv.org/html/2304.03442>
- Mem0: <https://arxiv.org/html/2504.19413>
- Zep/Graphiti: <https://arxiv.org/html/2501.13956>
- A-MEM: <https://arxiv.org/html/2502.12110>
- LangMem: <https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>
- MemoryBank: <https://arxiv.org/abs/2305.10250>
- ACT-R eviction in practice: <https://dev.to/futhgar/eviction-without-deletion-running-an-act-r-decay-policy-for-agent-memory-36hi>
- ACT-R approximations: <https://link.springer.com/article/10.1007/s42113-018-0015-3>
- CAMeR: <https://arxiv.org/html/2607.20458>
- RRF: <https://bigdataboutique.com/blog/reciprocal-rank-fusion-how-it-works-and-when-to-use-it>
- Letta: <https://www.letta.com/blog/agent-memory/>

## Deviations from `PLAN.md`

- `lastScore` / `lastScoredAt` became `relevance` / `relevanceConfidence` / `relevanceScoredAt`, plus a separate `importance` (Generative Agents: importance and relevance are different signals).
- `MemoryScorer` gained `importance(entryText)` and `configured()`.
- MCP `forget` archives rather than deletes, and can be restored in the inspector. Only the inspector's **Delete** removes an entry for good.
- When memory is disabled, digests and sweeps stop, but explicit MCP `remember` and `recall` keep working, so nothing an agent saves is lost.
- The service refuses text that looks like a credential (common API-key and private-key patterns).
