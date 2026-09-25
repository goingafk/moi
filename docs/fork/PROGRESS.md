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

### Verification

- `bun test`: 1,770 passed, 4 skipped, 0 failed. End-to-end auth tests use real server processes and cover HTTP and WebSocket acceptance/rejection plus startup refusal in both auth modes.
- `bun run typecheck`: passed.
- `bun run lint`: exited 0 with the same 9 pre-existing React warnings.
- `bun run format:check`: passed across 678 files.
- Verified current Tailscale Serve behavior against its official documentation and current source: it strips incoming identity headers, sets the login and header-info marker for user-owned tailnet requests, preserves the incoming Host, and overwrites the forwarded host/protocol/source headers.
- Direct-tailnet follow-up: `bun test` passed with 1,778 pass, 4 skip, 0 fail; typecheck and format passed; lint exited 0 with the same 9 existing warnings. Unit tests cover accepted/rejected peers, Host/Origin/proxy checks and bind validation; process tests cover startup refusal for unsafe binds and an empty allow-list. The actual container-to-MacBook connection remains owner-only verification.
- Manual phone access over the real tailnet remains owner-only verification.

### Decisions

- Approved: `bun run dev` defaults to auth off; non-dev starts default to Tailscale auth.
- Approved: Bun's development HTML shell and `/_bun/*` assets are served before application auth. They contain client source only; APIs, data-bearing vendor routes, `/status`, and both WebSockets remain gated. Prebuilt production installs gate the shell too.
- Replaced the earlier warning behavior: Tailscale mode now refuses a non-loopback `HOST`, matching auth-off mode.
- Trust current Tailscale Serve identity headers only on loopback and require its header marker plus forwarded HTTPS origin. A malicious local process remains in the trust boundary because it can also reach the control port and user files.
- Direct-tailnet mode is an explicit exception to the initial loopback-only design. It authenticates a device IP, not a human login; initially only the owner's MacBook is allowed. It does not add a password or allow LAN/public binds.

### Open items

- Verify the final deployment from a phone over Tailscale HTTPS; this requires the owner's server and tailnet.
- Verify the direct-tailnet deployment from the allowed MacBook; only the owner can run this on the container. HTTP over Tailscale may not satisfy browser secure-context requirements; use Serve-based HTTPS if those features are needed.
- Dev bundle source remains readable without auth by approved design; it exposes no workspace data.
- A process already running as the moi OS user can forge the full Serve header set. This is not separately defended because the loopback-only control port intentionally gives that same local trust domain agent control and file access.
- Cross-site top-level GET navigation remains allowed so links to moi work. The audited GET routes do not mutate state and the browser same-origin policy prevents the initiating site from reading their responses; cross-site WebSockets, preflights, fetches, and form posts are refused.

## Phase 2 — Multi-agent sessions and the unified model picker

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 2 tasks in `PLAN.md`.

## Phase 3 — Permission modes

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 3 tasks in `PLAN.md`.

## Phase 4 — Web terminal

### Summary

Not started.

### Verification

Not run.

### Decisions

None yet.

### Open items

All Phase 4 tasks in `PLAN.md`.

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
