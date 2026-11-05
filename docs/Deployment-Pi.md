# Deployment (Raspberry Pi)

Assumes host layout:

| Path | Role |
|------|------|
| `/home/pi/cdn-module-gaze` | App working directory |
| `/home/pi/.bun/bin/bun` | Bun binary used by systemd |
| `/home/pi/oc4d-server/workspaces/website/uploads/modules` | Module uploads root |
| `/var/log/modulegaze` | Gaze log directory |
| Port `3002` | HTTP UI + APIs |

## Install / redeploy

```bash
ssh pi@cdn.local   # or your host alias
cd /home/pi/cdn-module-gaze   # or clone fresh:
# git clone https://github.com/ComDevNet/cdn-module-gaze.git && cd cdn-module-gaze

chmod +x install.sh
./install.sh
```

[`install.sh`](../install.sh) will:

1. Install `figlet` / `toilet` (banner)
2. Install Bun if needed
3. `bun install` + `bun run build` (`prisma generate && next build`)
4. Copy `cdnmodulegaze.service` → `/etc/systemd/system/`
5. `daemon-reload`, `enable`, and **`restart`** the unit (restart ensures new builds and env vars apply)

## systemd unit

[`cdnmodulegaze.service`](../cdnmodulegaze.service):

- `WorkingDirectory=/home/pi/cdn-module-gaze`
- `ExecStart=/home/pi/.bun/bin/bun run start`
- `Restart=always` with burst limits
- Production env: background monitor, access tee, journal since today, 5-minute periodic flush, log dir, uploads root

## Verification checklist

```bash
sudo systemctl daemon-reload
sudo systemctl restart cdnmodulegaze
sudo systemctl status cdnmodulegaze --no-pager

curl -s http://127.0.0.1:3002/api/modules
curl -s http://127.0.0.1:3002/api/live-sessions
curl -s http://127.0.0.1:3002/api/stats

sudo systemctl show cdnmodulegaze -p Environment

sudo journalctl -u cdnmodulegaze -f

sudo ls -lah /var/log/modulegaze
sudo tail -n 20 /var/log/modulegaze/modulegaze-access.log
sudo tail -n 20 /var/log/modulegaze/modulegaze-sessions.log
```

Open `http://oc4d.cdn:3002` (or the Pi hostname/IP on port 3002). With background monitor on, sessions appear without requiring “Start Monitoring” for tracking; the button pauses/resumes the live view.

### Daily zip without waiting for midnight

Stop the service, set a live log file’s mtime to yesterday, start the service, trigger one new write; the previous-day file should zip automatically.

## `update.sh`

Present in the repo but currently an **empty stub**. Redeploy with `git pull` + `./install.sh` (or build + `systemctl restart`) until an update script is implemented.

## Coupling to oc4d

- Same Postgres DB and `User` / `Module` tables
- Journal unit name must remain `oc4d.service`
- Heartbeat script injection is configured in oc4d module serving, not in this unit
