# Shared memory (Phase 6)

One memory shared by every agent on every machine. The memory service is a separate repo (`memory-service`), deployed next to moi on the LXC. moi is one of its clients: it adds relevant memories to every chat message, gives agents a `moi memory add` command, and has a **Memory** settings page to inspect and edit entries. Claude Code, Codex and Cline on any allow-listed machine reach the same memory over MCP.

Design, scoring model and research: `memory-design.md`.

## Set it up

1. **Deploy the service** on the LXC (see the memory-service `README.md`). Its `allowedIps` must include the **LXC's own Tailscale IP**, since moi calls it there, plus the MacBook's. Store the TypeSafe key with `bun src/cli.ts secret set typesafe-api-key`.
2. **Point moi at it:** Settings → Memory → enter `http://<lxc-tailnet-ip>:13380` → **Save address**. The status line should say _Connected_, with Jev ready.
3. **Optional, embeddings:** pull an embedding model on the Ollama server (`ollama pull nomic-embed-text`) and add `embeddings` to the service's `config.json`. Without it, similarity is keyword-only.
4. **Register MCP** in each agent CLI that should save or search memory directly. Commands are in the service README: `claude mcp add --transport http …`, `codex mcp add … --url …` plus `default_tools_approval_mode`, and Cline's `streamableHttp` entry.

Updating an existing deployment follows `remote-setup.md` section 2.

## What moi does

- **Before each chat send**, the server asks the service for a digest of the workspace's project, plus the chat's session once it has a permanent id, and appends it to the message's `<moi-context>` directives (`server/memory/index.ts`, `lib/memory.ts`). The call has an 800 ms timeout. A slow, down, refusing or disabled service means no digest, never a failed send. Memory text is escaped so it cannot close the envelope, and it is labelled as context, not instructions.
- **Project identity** is the workspace's `origin` remote URL (or its absolute path), resolved once per workspace. The service normalises it, so `git@github.com:a/b.git` on the MacBook and `https://github.com/a/b` on the LXC are the same project.
- **`moi memory add "<fact>" [--scope project|global|session] [--session <id>]`** goes through the loopback control port. The server fills in the project and provenance (agent and model from the chat's binding when `--session` is given, and this machine's hostname), then forwards the fact to the service. The digest header tells agents this command and their session id.
- **Settings → Memory** holds the service address, _Share memory with agents_ (the service's `enabled`), the scorer, and the archive threshold. It also lists entries with filters, search, add, edit, pin, restore and delete. All of this goes through moi's authenticated `/api/memory/*` proxy; the browser never calls the service.
- **Usage:** refreshing the Usage panel reads the service's Jev token totals and shows them as the _Jev · memory_ spend row, priced like the Phase 5 Jev row.

## Troubleshooting

- _"The memory service refused moi … allowedIps"_: add the LXC's Tailscale IP to the service's `allowedIps` and restart it.
- _Unreachable_: check `systemctl --user status memory-service` and whether the address is the LXC's Tailscale IPv4 and port.
- A chat doesn't mention a memory: the digest shows at most 12 entries, ranked by relevance to the message. Pin an entry to always include it.
- The server log shows `[memory] digest skipped: …` whenever a digest is dropped.
