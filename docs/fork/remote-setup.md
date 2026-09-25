# Remote setup: moi over Tailscale

For a simple direct connection, moi can listen on the container's **Tailscale IPv4 address only**. Configure the MacBook's Tailscale IPv4 address as the sole allowed peer, then open `http://<container-tailnet-ip>:13337` on that MacBook. No Tailscale Serve, MagicDNS, certificate, or moi login is needed for this mode.

This is device-IP access, not a user login: anyone controlling the allowed MacBook can operate moi and its agents. Traffic travels over Tailscale, but the browser URL is HTTP, so browser features that require a secure context may be unavailable. Never forward port 13337 from the router or bind moi to `0.0.0.0`.

## 1. Make sure Tailscale runs inside the container

On the container, run:

```sh
tailscale ip -4
```

It must print the IP you intend to use for moi. Reaching the container through a subnet router or a Tailscale installation on the Proxmox host is **not** enough: the address must belong to the container's own Tailscale interface. Check the MacBook's address with `tailscale ip -4` on the MacBook. Tailscale device IPv4 addresses normally come from `100.64.0.0/10`; moi validates that range but cannot prove an address belongs to Tailscale. [Tailscale IP reference](https://tailscale.com/docs/reference/reserved-ip-addresses).

## 2. Install the Phase 1 branch from source

The direct-tailnet code is on `fork/phase-1-security`, not `main`. From the development machine, push the latest commit to the fork before updating the container:

```sh
git push origin fork/phase-1-security
```

Then on the container (Linux, systemd):

```sh
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/goingafk/moi.git ~/moi
cd ~/moi
git fetch origin
git switch --track origin/fork/phase-1-security
bun install
bun run build:client
bun link
```

For an existing checkout, skip `git clone`, then fetch and switch. If the local branch already exists, use `git switch fork/phase-1-security` followed by `git pull --ff-only` instead of `git switch --track`. After later pulls, rerun `bun run build:client`. Install and log in to the agent CLI you plan to use as the same OS user that runs moi.

## 3. Configure direct-tailnet access

Create `~/.local/share/moi/config.json` (or use `MOI_DATA_DIR` to choose another data directory):

```json
{
  "auth": "tailnet-ip",
  "tailnetIp": "<container-tailnet-ip>",
  "allowedIps": ["<macbook-tailnet-ip>"]
}
```

Replace the placeholders with the addresses printed by `tailscale ip -4` on each device. `MOI_AUTH`, `MOI_TAILNET_IP`, and comma-separated `MOI_ALLOWED_IPS` override the file. Restart moi after changing the file. An empty `allowedIps` list prevents startup. `HOST` should be unset; moi takes the bind address from `tailnetIp`. If `HOST` is set, it must match `tailnetIp` exactly. The control port (`127.0.0.1:13059`) stays loopback-only and must never be published.

Direct mode checks the real peer address reported by Bun, not a client-supplied header. It rejects Tailscale Serve/proxy headers, requests from loopback or LAN peers, a Host other than the configured Tailscale IP, and cross-site browser requests. Every API route and both WebSocket upgrades use the same check. There is no password or browser login in this mode.

## 4. Run moi as a service

`moi service install` only supports npm global installs. For a git checkout, create `~/.config/systemd/user/moi.service`:

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
loginctl enable-linger "$USER"
journalctl --user -u moi -f
```

The startup log should say `auth: direct Tailscale IP — 1 allowed device`. If it fails to bind, recheck `tailscale ip -4` **inside the container**, the `tailnetIp` setting, and any `HOST` environment override.

## 5. Open and test it

From the allowed MacBook, while Tailscale is connected, open:

```text
http://<container-tailnet-ip>:13337
```

From the MacBook terminal, `curl -i http://<container-tailnet-ip>:13337/api/config` should return `200`. A non-allowed tailnet device should get `403` if its network policy permits reaching the port at all. The container's own `curl` to that URL should be refused because the container is not on `allowedIps`.

If ping works but the browser cannot connect, check `systemctl --user status moi`, `journalctl --user -u moi -n 50`, the container firewall, and Tailscale grants/ACLs for TCP port 13337. A `401` means the request did not arrive directly from an allowed Tailscale peer (or carried proxy headers); a `403` means the device IP, Host, or browser origin failed the check. When a device's Tailscale IP changes, update `allowedIps` and restart moi.

## Alternative: HTTPS through Tailscale Serve

The original, stricter deployment remains available. It binds moi to loopback, uses Tailscale Serve's HTTPS identity headers, and allow-lists **user logins** rather than device IPs. This is preferable when several devices need access or browser secure-context features matter.

Set `auth` to `tailscale`, set `allowedUsers` to Tailscale login names, and set `publicUrl` to the Serve HTTPS origin in `config.json`:

```json
{
  "auth": "tailscale",
  "publicUrl": "https://my-server.my-tailnet.ts.net",
  "allowedUsers": ["goingafk@github"]
}
```

Leave `HOST` unset. Enable MagicDNS and HTTPS certificates in the tailnet admin console, then run Tailscale Serve **inside the same container**:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:13337
tailscale serve status
```

Open the HTTPS `ts.net` URL shown by Serve. Find a login with `tailscale whois <client-tailnet-ip>` (read `UserProfile.LoginName` in JSON output) or in the admin console's Users page. With an empty allow-list, every request is denied. Tagged devices have no user login header and are denied. Never use Tailscale Funnel for moi. The Serve setup publishes machine names to the public Certificate Transparency log; avoid sensitive names. [Tailscale Serve docs](https://tailscale.com/kb/1312/serve).

## Local development

`bun run dev` defaults to `auth: off` and listens on `127.0.0.1`; open `http://localhost:13337`. Production `moi start` defaults to Serve-based `tailscale` auth when `auth` is unset. `off` permits only direct loopback requests without proxy headers, and both `off` and Serve-based `tailscale` refuse non-loopback binds.

In development, Bun serves the HTML shell and `/_bun/*` bundles before moi's auth runs. They contain only the open-source client code. APIs, `/status`, and both WebSockets are still checked. Prebuilt production installs gate the shell too. Server-side browser testing in production must use the configured remote URL; direct `localhost` requests are denied in both remote modes.
