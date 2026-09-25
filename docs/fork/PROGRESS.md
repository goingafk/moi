# Fork progress

This log records the durable outcome of each phase in `PLAN.md`. Update the matching section before ending a phase.

## Phase 0 — Orientation and fork hygiene

### Summary

- Added and corrected `PLAN.md`; pointed package metadata at `github.com/goingafk/moi` while retaining the Elastic License 2.0.
- Added `selfUpdate` deployment config (`config.json` / `MOI_SELF_UPDATE`), default off. The CLI update command and both update API endpoints stop before contacting npm when disabled.
- Pointed `AGENTS.md` at the fork plan. Disabled tag-triggered npm releases; the workflow is manual-dispatch only.
- Corrected stale environment-documentation paths and recorded corrections to the initial architecture audit in `PLAN.md`.

### Verification

- Baseline: 1,727 tests passed, 4 skipped; typecheck passed; lint exited 0 with 9 existing warnings; format initially failed only on the unformatted plan.
- Final: 1,731 tests passed, 4 skipped; typecheck passed; lint retained the same 9 existing warnings; format passed.
- Four new tests covered config parsing, update API behavior with the flag on/off, and an offline-registry CLI check proving disabled updates make no npm request.
- `bun run dev` bound HTTP and control ports to `127.0.0.1`; the page and update paths behaved as configured.

### Decisions

- Keep npm self-update code available but opt-in, because the published `moi-computer` package is upstream and would replace this fork.
- Keep the keychain service name `com.molefrog.moi` to avoid orphaning existing secrets.
- Keep skill provisioning as copying for now; Phase 2 must make the copy-versus-symlink decision explicitly.

### Open items

- The npm package name still collides with upstream. Publishing remains manually gated; renaming distribution was not part of Phase 0.
- No Phase 0 test failures remained.

## Phase 1 — Security for remote access

### Summary

- Added one auth gate for every HTTP API/static route, `/status`, and both WebSocket upgrades. Tailscale mode accepts only a configured login delivered through same-host HTTPS Tailscale Serve headers on a loopback connection; auth-off mode accepts only direct loopback requests with a loopback Host.
- Added cross-site request protection for Origins, Fetch Metadata, WebSocket upgrades, preflights, and form posts; blocked Funnel traffic, incomplete/spoofed proxy-header shapes, DNS-rebinding Hosts in auth-off mode, and every non-loopback bind in both modes.
- Kept the unauthenticated control server hard-bound to `127.0.0.1` and documented that local-process trust boundary.
- Added `publicUrl` / `MOI_PUBLIC_URL` for CLI browser links in Tailscale mode. CLI commands continue to use the control port for operations and no longer open an unauthenticated localhost URL remotely.
- Audited internal HTTP use: `thumbnails.ts` and `preview.ts` are response handlers, not HTTP clients; applet fetches and both browser sockets use relative same-origin URLs; operational CLI paths use the control port. Server-side browser testing must use the Serve origin or a separate auth-off dev port.
- Added the Tailscale service and Serve setup guide in `remote-setup.md`.
- Owner-approved follow-up: added direct-tailnet device-IP mode for the first container deployment. It binds only the configured Tailscale IPv4 address, allow-lists client device IPs, rejects proxy headers and cross-site requests, and leaves Serve mode unchanged. Updated the setup guide to lead with this mode.
- Deployment follow-up: direct HTTP is an insecure browser context, so `crypto.randomUUID()` was unavailable and the Send action failed before reaching either harness. Replaced browser-side UUID calls with a shared version-4 fallback using `crypto.getRandomValues()`, which is available on HTTP origins. Covered chat, attachments, annotations, and the harness debug page.

### Verification

- `bun test`: 1,770 passed, 4 skipped, 0 failed. End-to-end auth tests use real server processes and cover HTTP and WebSocket acceptance/rejection plus startup refusal in both auth modes.
- `bun run typecheck`: passed.
- `bun run lint`: exited 0 with the same 9 pre-existing React warnings.
- `bun run format:check`: passed across 678 files.
- Verified current Tailscale Serve behavior against its official documentation and current source: it strips incoming identity headers, sets the login and header-info marker for user-owned tailnet requests, preserves the incoming Host, and overwrites the forwarded host/protocol/source headers.
- Direct-tailnet follow-up: `bun test` passed with 1,778 pass, 4 skip, 0 fail; typecheck and format passed; lint exited 0 with the same 9 existing warnings. Unit tests cover accepted/rejected peers, Host/Origin/proxy checks and bind validation; process tests cover startup refusal for unsafe binds and an empty allow-list. The actual container-to-MacBook connection remains owner-only verification.
- HTTP-browser follow-up: the owner confirmed `window.isSecureContext === false` and `typeof crypto.randomUUID === 'undefined'` at the direct Tailscale URL. The fallback has two focused tests (native and HTTP-like paths); the full suite passed with 1,780 pass, 4 skip, 0 fail when loopback socket access was permitted. Typecheck, lint (same 9 existing warnings), format, and the production client build passed. The first sandboxed full test attempt failed in 19 socket-binding tests with `EPERM` because the local sandbox disallowed loopback listeners; the unrestricted rerun passed.
- Manual phone access over the real tailnet remains owner-only verification.

### Decisions

- Approved: `bun run dev` defaults to auth off; non-dev starts default to Tailscale auth.
- Approved: Bun's development HTML shell and `/_bun/*` assets are served before application auth. They contain client source only; APIs, data-bearing vendor routes, `/status`, and both WebSockets remain gated. Prebuilt production installs gate the shell too.
- Replaced the earlier warning behavior: Tailscale mode now refuses a non-loopback `HOST`, matching auth-off mode.
- Trust current Tailscale Serve identity headers only on loopback and require its header marker plus forwarded HTTPS origin. A malicious local process remains in the trust boundary because it can also reach the control port and user files.
- Direct-tailnet mode is an explicit exception to the initial loopback-only design. It authenticates a device IP, not a human login; initially only the owner's MacBook is allowed. It does not add a password or allow LAN/public binds.

### Open items

- Verify the final deployment from a phone over Tailscale HTTPS; this requires the owner's server and tailnet.
- Verify chat sends from the allowed MacBook after redeploying the rebuilt client. Direct HTTP still lacks secure-context-only browser features other than the UUID calls now covered by a fallback; use Serve-based HTTPS if those features are needed.
- Dev bundle source remains readable without auth by approved design; it exposes no workspace data.
- A process already running as the moi OS user can forge the full Serve header set. This is not separately defended because the loopback-only control port intentionally gives that same local trust domain agent control and file access.
- Cross-site top-level GET navigation remains allowed so links to moi work. The audited GET routes do not mutate state and the browser same-origin policy prevents the initiating site from reading their responses; cross-site WebSockets, preflights, fetches, and form posts are refused.

## Phase 2 — Multi-agent sessions and the unified model picker

### Summary

- Implemented per-session agent binding in the per-user data directory. The workspace type remains the default for new chats. Claude, Codex, and Ollama-backed Claude sessions can coexist in one workspace; listing, selected-session recovery, sending, Stop, events, archive, status snapshots, previews, debug routing, and workspace teardown were reviewed and routed appropriately. Existing histories are discovered and bound on first listing.
- New sessions on a harness provision bundled skills into that harness's workspace skill directory. The implementation keeps the existing copy-based provisioning, which is idempotent and preserves unrelated workspace skills.
- Added app-level Ollama server settings and a grouped model catalog. Discovery checks installed models, tool capability, and warm/cold state; the picker refreshes on open, disables models without tools, and starts a new chat when switching agents. Chat rows show their agent. Auto mode remains hidden; `modelMode` defaults to `manual` for Phase 7 compatibility.
- Ollama chats run through Claude Code with a server-resolved local environment and a project-only, strict MCP profile. The configurable `localMcpServers` allow-list admits only named servers from that workspace's `.mcp.json`; default is none. Local profile settings do not leak into normal Claude chats.
- Kept view builders on the workspace-default harness and picker, because their submission path is separate from ordinary chat and is not yet session-agent aware.
- Fixed a first-send rename race: the server now persists the permanent session's agent/model before announcing its ID, and the client refetches that config instead of indefinitely displaying a copied temporary draft.

### Verification

- `bun test`: 1,794 passed, 4 skipped, 0 failed after the rename-cache regression test; the HTTP/WebSocket tests required local loopback socket permission. The sandboxed run failed 25 socket-dependent tests with `EPERM`; the permitted rerun passed.
- `bun run typecheck`: passed. `bun run lint`: passed with the same 9 pre-existing React warnings. `bun run format:check`: passed. `bun run build:client`: passed.
- New tests cover model catalog IDs/grouping, picker selection across duplicate provider IDs, Ollama discovery/cache with a fake HTTP server, settings validation, per-session binding/immutability/rename, skill provisioning, local-vs-cloud environment isolation, and strict MCP metadata probes.
- Live MacBook-to-Ollama probe: `qwen3.8:27b` at `100.125.20.45:11434` answered through Claude Code 2.1.282 with the local profile. Structured output confirmed a real `Bash(pwd)` tool call and result, and zero MCP servers loaded. The CLI did not hang on cloud MCP discovery. See `server/ollama/NOTES.md` for the verified API shapes and CLI warnings.
- Production moi browser smoke test with isolated temporary data: added the Ollama server in Models settings, selected Qwen, sent a workspace-path prompt, and confirmed the permanent chat retained its Qwen binding after the rename fix. Switching that chat to Codex and then Claude created separate chats; all three answered and appeared with correct agent labels in the same workspace. The temporary test data was removed after the server and browser were stopped.

### Decisions

- Add stable server IDs to the `{name, baseUrl}` setting so existing session bindings survive a server rename; removing a server makes its chats refuse to send until it is restored.
- Keep skill copies rather than symlinks. The plan's symlink convention applies to this repository's `.agents`/`.claude` tree; `moi init` already copies skills into user workspaces, including on other machines.
- Keep a session on one agent for its lifetime. Choosing another provider in the picker creates a new chat; Phase 7 may add explicit mid-session routing with continuity through memory.
- Use the SDK's `strictMcpConfig` for local sessions while retaining project settings so workspace skills are loaded. The installed Claude Code 2.1.282 CLI documents the matching flag; a live local run succeeded without MCP startup hanging.

### Open items

- Acceptance remains pending on the owner LXC: verify the container can reach the Ollama server, deploy this branch, add the server in Models settings, then exercise Claude, Codex, and Qwen chats and a tool/skill in each on that deployment. The MacBook test does not prove the container path.
- The dev-bundled Models page hit an `Input` element-type runtime error during browser testing, while the production build rendered and worked. The dev-bundler-only failure has not been diagnosed; use the production build for the current deployment check.
- The alternate-agent composer currently infers availability from a successful model-catalog row. A provider-specific login/health banner for non-default agents would improve expired-login feedback, but failed sends remain visible in chat.
- Claude Code warns that `qwen3.8:27b` is not in its built-in model catalog and assumes a 200k-token context window. The model answered and used a tool; tune the context-window setting only if a real long-session limit appears.

## Phase 3 — Permission modes

### Summary

- Added per-chat `auto`, `ask-risky`, and `ask-all` modes, saved with per-user session settings. Claude and Codex default to `auto`; Ollama-backed Claude defaults to `ask-risky`. The composer can change a chat's mode and settings expose defaults, risk switches, and custom ask/allow patterns.
- Added a shared classifier for paths (including bare relative shell arguments and symlink escapes), shell commands, network, Git, system operations, sensitive files, and unknown tools. Unclassified executables ask by default. `alwaysAsk` wins over `alwaysAllow`, then built-in rules.
- Claude's pre-tool hook and fallback permission callback now wait for browser decisions in ask modes. Codex app-server approval requests do the same; unknown threads are denied. Pending cards survive reconnect through the socket snapshot, and Stop denies outstanding approvals. Decisions are appended to a local audit file without raw command arguments.
- Codex's `Ask all` is disabled: its app-server does not present every sandbox-allowed tool call for approval. See the harness notes for protocol details.

### Verification

- `bun test`: 1,800 passed, 4 skipped, 0 failed with loopback socket permission. A sandboxed run failed 25 existing socket-dependent tests with `EPERM`; the permitted rerun passed.
- `bun run typecheck`: passed. `bun run lint`: passed with the same 9 pre-existing React warnings. `bun run format:check`: passed. `bun run build:client`: passed.
- Added classifier/path-escape, approval lifecycle/reconnect/interrupt/audit, and Codex native-approval tests. Verified Codex's wire shapes from the installed CLI's generated schema and Claude's hook types from the installed SDK.

### Decisions

- The owner chose to disable `Ask all` for Codex, rather than change how Codex loads project settings. Server validation enforces the same constraint.
- No per-workspace permission defaults: the selected mode belongs to the user's chat; project-shared settings would be the wrong owner.
- Preserve Codex's existing `on-request` workspace sandbox in auto mode. Ask-risky only governs requests Codex actually emits.

### Open items

- The Claude SDK hook timeout is set to one day, not literally infinite; its matcher has a finite timeout field. The UI has no expiry. A true unlimited wait would require an SDK-supported no-timeout mechanism.
- Codex's native denial response cannot carry the optional note, so its agent sees a denial without the browser's note. Claude receives the note in its denial reason.
- Live Ollama/Claude/Codex approval-card acceptance on the owner's LXC remains unverified; local tests use fakes. In particular, Codex `Ask risky` cannot intercept commands that its sandbox already allows.

## Phase 4 — Web terminal

### Summary

- Added a terminal tab with xterm.js, a fit addon, reconnect control, mobile paste field, copy action, and create/reattach/rename/stop controls. Login shortcuts fill verified CLI commands for the user to review and send.
- Server terminals are UUID-named tmux sessions with metadata in the per-user data directory. Bun's native PTY attaches a WebSocket client to each tmux session; closing the socket stops the attachment but leaves tmux running. API and socket routes use the Phase 1 auth gate and additionally refuse `auth: off`.
- Updated the direct-tailnet setup guide with the tmux prerequisite and concrete steps for the existing `/home/moi/moi` container checkout. Bun PTY and installed CLI login commands are recorded in `terminal-notes.md`.

### Verification

- `bun test`: 1,804 passed, 5 skipped, 0 failed with loopback socket permission. The extra skip is the real tmux reattach test because tmux is not installed on this Mac. Bun native PTY input/output passed locally; auth integration tests passed against real server processes, including terminal HTTP and WebSocket refusal with auth off.
- `bun run typecheck`: passed. `bun run lint`: passed with the same 9 pre-existing React warnings. `bun run format:check`: passed. `bun run build:client`: passed.
- Locally installed `codex-cli 0.153.4` advertises `login --device-auth`; the installed Claude CLI advertises `auth login`. No login was performed using the owner's credentials during development.

### Decisions

- Use Bun's native PTY, so no native PTY package is added. Add only `@xterm/xterm` and its fit addon on the client; tmux is an OS prerequisite, not a bundled dependency.
- Disable terminal access in auth-off development mode, even on loopback. This is a remote shell and needs an authenticated device/user boundary.
- Do not add a login-protocol parser: the CLI output is rendered in the terminal and the user follows its printed URL/code. The existing harness `startLogin` hooks remain available in the chat setup flow.

### Open items

- A real tmux detach/reattach test is present but skipped on this Mac because tmux is not installed. Run it on the LXC after installing tmux, then test a phone disconnect/reconnect and both CLI login flows as the `moi` service user. Until then, the plan's phone-level done condition is not verified.
- Container follow-up: tmux reported `terminal does not support clear` when the service opened a terminal. The attachment and control commands now set `TERM=xterm-256color` explicitly; this is unit-tested, but the owner's LXC must confirm the live fix after redeployment.
- Follow-up verification: `bun test` passed with 1,805 pass, 5 skip, 0 fail; typecheck and lint passed (the same 9 warnings), and format check passed.
- Browser Clipboard API copy may be unavailable on direct-tailnet HTTP. The mobile paste field works without a secure context; Tailscale Serve HTTPS is the option for secure-context clipboard features.

## Phase 5 — Usage tracking

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 5 tasks in `PLAN.md`.

## Phase 6 — Memory service and moi integration

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 6 tasks in `PLAN.md`.

## Phase 7 — Router and Auto routed mode

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 7 tasks in `PLAN.md`.

## Phase 8 — Mobile

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 8 tasks in `PLAN.md`.

## Phase 9 — Later

### Summary

Not started; do not start without owner approval.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 9 items in `PLAN.md`.
