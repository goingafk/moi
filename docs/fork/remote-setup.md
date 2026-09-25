# Remote setup: moi on a server, over Tailscale

moi runs on your server bound to `127.0.0.1`. Tailscale Serve publishes it to your tailnet over HTTPS and tells moi who each request is from. moi only accepts requests from Tailscale logins on its allow-list. Nothing is reachable from outside the tailnet.

```
phone / laptop ──HTTPS (tailnet only)──▶ tailscale serve ──http──▶ 127.0.0.1:13337 (moi)
                                         adds Tailscale-User-Login
```

## How auth works

`server/auth.ts` checks every request to the HTTP port: the API, both WebSockets, `/status`, and static files in a prebuilt install. There are two modes, set with `auth` in `config.json` or `MOI_AUTH`:

| Mode        | Accepts                                                                                                          | Use it for                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `tailscale` | Requests from loopback that carry a `Tailscale-User-Login` on the allow-list                                     | The server, behind Tailscale Serve  |
| `off`       | Direct loopback requests with a `localhost`/`127.0.0.1` Host and **no** proxy headers; anything proxied gets 401 | A laptop, opening `localhost:13337` |

If `auth` is not set, it is `off` under `bun run dev` and `tailscale` for everything else (`moi start`, services).

Both modes also refuse cross-site browser requests (a mismatched origin, including the scheme, or `Sec-Fetch-Site: cross-site` on anything but a top-level GET). Tailscale Serve adds your identity to every request your browser sends. Without this check, any web page you visit could drive moi as you. Tailscale mode additionally requires Serve's complete HTTPS proxy-header shape; a bare `Tailscale-User-Login` is not enough.

What Tailscale Serve does, checked against its source (`ipn/ipnlocal/serve.go`, `addTailscaleIdentityHeaders`) and [the Serve docs](https://tailscale.com/kb/1312/serve):

- It removes any `Tailscale-User-Login`, `-Name`, `-Profile-Pic`, `Tailscale-Funnel-Request` and `Tailscale-Headers-Info` the client sent, so browsers can't forge them.
- It sets `Tailscale-User-Login` only for tailnet devices signed in as a user. **Tagged devices get no identity**, so moi answers them 401.
- Funnel (public) traffic gets `Tailscale-Funnel-Request: ?1` and no identity. moi refuses it. Never put moi behind Funnel.
- Non-ASCII values are RFC 2047-encoded. moi compares the raw header, so an encoded login never matches the allow-list.
- It always sets `X-Forwarded-Host`, `X-Forwarded-For` and (for HTTPS) `X-Forwarded-Proto`. That is how `off` mode detects a proxied request.

Trust boundary: identity headers are trusted only on connections from `127.0.0.1`/`::1`. Any process on the server can connect over loopback and forge them. That is accepted: such a process can already use the control port (below) and read your files. Don't put any other reverse proxy in front of moi; it might not strip the headers.

## The control port

The CLI and agents (`moi bundle`, `moi tabs`, `moi env`, …) talk to the server over a second port, `127.0.0.1:13059`. **It is loopback-only and unauthenticated by design.** Its host is hard-coded (`CONTROL_HOST` in `server/constants.ts`; `MOI_CONTROL_PORT` changes only the port). A test pins this. Never publish it with `tailscale serve` or anything else.

## 1. Install moi from source

On the server (Linux, systemd):

```sh
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/goingafk/moi.git ~/moi
cd ~/moi
bun install
bun run build:client   # prebuilt client in dist/; rerun after every pull
bun link               # puts `moi` on PATH for agents
```

Install and log in to the agent CLIs (`claude`, `codex`) as the same user that will run moi.

## 2. Configure auth

Find your Tailscale login (the `goingafk@` shown by `tailscale status` is shortened). Either:

- run `tailscale whois <your-phone's-100.x-ip>` and read `Name` under `User` (it's the login, e.g. `goingafk@github` on a GitHub-authenticated tailnet; `--json` shows it as `UserProfile.LoginName`), or
- read it from the Users page of the Tailscale admin console.

Then create `~/.local/share/moi/config.json` (the data dir; `MOI_DATA_DIR` overrides it):

```json
{
  "auth": "tailscale",
  "publicUrl": "https://my-server.my-tailnet.ts.net",
  "allowedUsers": ["goingafk@github"]
}
```

`MOI_AUTH`, `MOI_PUBLIC_URL`, and `MOI_ALLOWED_USERS` (comma-separated) override the file. `publicUrl` is the HTTPS origin printed and opened by CLI commands; without it, the CLI prints only the workspace path rather than a non-working localhost link. To add someone, add their login to `allowedUsers` and restart moi. With an empty list, every request is refused. The startup log says so (`auth: Tailscale — no allowed users yet`).

## 3. Run moi as a service

`moi service install` only supports npm global installs; it refuses a git checkout. Use a systemd user unit instead, at `~/.config/systemd/user/moi.service`:

```ini
[Unit]
Description=moi
After=network-online.target

[Service]
WorkingDirectory=%h/moi
ExecStart=%h/.bun/bin/bun server/cli.ts start
Environment=MOI_SERVER=1
Environment=PATH=%h/.bun/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now moi
loginctl enable-linger "$USER"     # keep it running when you're logged out
journalctl --user -u moi -f        # should print "auth: Tailscale — 1 allowed user"
```

Leave `HOST` unset. moi then binds `127.0.0.1`. In either auth mode, moi refuses to start on a non-loopback `HOST`; the loopback bind is part of the identity-header trust boundary.

## 4. Publish it with Tailscale Serve

One-time tailnet setup in the admin console's DNS page: enable MagicDNS, then **HTTPS Certificates → Enable HTTPS**. This publishes your machine names to the public Certificate Transparency log, so don't use this with sensitive machine names. Serve fetches the certificate itself on the first HTTPS request.

```sh
tailscale serve --bg --https=443 http://127.0.0.1:13337
tailscale serve status              # shows https://<machine>.<tailnet>.ts.net
```

Open `https://<machine>.<tailnet>.ts.net` from your phone or laptop on the tailnet.

To stop publishing: `tailscale serve --https=443 off`, or `tailscale serve reset` to clear all Serve config.

## Checking it

From the server:

```sh
curl -i http://127.0.0.1:13337/api/config        # 401: no identity
curl -i https://<machine>.<tailnet>.ts.net/api/config   # from a tailnet device: 200 if you're allowed, 403 if not
```

From a device not on the tailnet, the `ts.net` name doesn't resolve and nothing answers.

## Local use on a laptop

`bun run dev` needs nothing: auth defaults to `off` and you open `http://localhost:13337`. For `moi start` on a laptop, set `"auth": "off"` in `config.json`. `off` still refuses proxied requests, so putting it behind Tailscale Serve by mistake fails closed (401).

## Browser and view testing on the server

Do not point a browser tool at `http://localhost:13337` while the production server uses Tailscale auth: direct HTTP requests intentionally get 401. Use the configured `publicUrl` from a user-owned tailnet device, or run a separate development server with auth off on another loopback port. Applet thumbnails, image previews, applet RPC calls, and WebSockets are browser-originated relative URLs, so they continue through the authenticated Serve origin. Agent and CLI operations use the loopback-only control port and do not need HTTP auth.

## Known gap

In dev mode (`bun run dev`), Bun serves the HTML shell and its `/_bun/*` bundles before moi's auth runs, so they are readable without auth. They contain only the open-source client code. Everything with data (the API, both WebSockets, `/status`) is still checked. Prebuilt installs check everything.
