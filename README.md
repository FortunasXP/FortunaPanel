# FortunaPanel

A modern, self-hosted Minecraft server management panel. Run it as a Windows desktop app, a Docker container, or directly on a Linux server.

## Features

- **Multi-server management** — Create, start, stop, restart, and monitor multiple Minecraft servers from one dashboard
- **Real-time console** — Live server output with command input via WebSocket
- **File manager** — Browse and edit server files in-browser
- **Plugin management** — Search and install plugins directly from Modrinth
- **Backup system** — Manual and scheduled backups with one-click restore
- **Network/proxy support** — Link Velocity or BungeeCord proxies with backend servers
- **Player management** — View online players, manage whitelist, bans, and ops
- **Scheduled tasks** — Cron-style scheduler for restarts, commands, and backups
- **Resource monitoring** — Live CPU, memory, and disk usage per server
- **Multi-user & permissions** — Role-based access control with per-server permissions
- **Two-factor auth** — TOTP-based 2FA for admin accounts
- **API keys** — Generate scoped API keys for external integrations
- **SFTP access** — Built-in SFTP server for remote file access
- **Discord notifications** — Webhook alerts for server events
- **Auto-restart & crash detection** — Configurable auto-restart with crash limits
- **Update checker** — Automatic notifications when a new version is available
- **Dark theme** — Clean, modern UI built with Tailwind CSS

## Deployment Options

### Windows Desktop (Electron)

Download the installer from [Releases](https://github.com/FortunasXP/FortunaPanel/releases). Run the setup wizard — it bundles Node.js, Java detection, and everything you need.

### Docker

```bash
docker run -d \
  --name fortunapanel \
  -p 3000:3000 \
  -p 25565-25575:25565-25575 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v panel-data:/app/data \
  -v panel-servers:/app/servers \
  -v panel-logs:/app/logs \
  fortunapanel
```

Or with docker-compose:

```bash
git clone https://github.com/FortunasXP/FortunaPanel.git
cd FortunaPanel
# Edit docker-compose.yml to set your JWT_SECRET
docker compose up -d
```

### Linux (Bare Metal)

```bash
curl -fsSL https://raw.githubusercontent.com/FortunasXP/FortunaPanel/master/install.sh | bash
```

The installer sets up Node.js 22, Java 17, creates a systemd service, and generates a secure JWT secret. Access the panel at `http://your-server:3000`.

### Manual Setup

```bash
git clone https://github.com/FortunasXP/FortunaPanel.git
cd FortunaPanel
npm ci --omit=dev
# Set a secure secret
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
node src/index.js
```

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Panel web port |
| `HOST` | `0.0.0.0` | Bind address |
| `JWT_SECRET` | — | **Required in production.** Random secret for token signing |
| `JWT_EXPIRY` | `24h` | Token lifetime (max 7d) |
| `SERVERS_ROOT` | `./servers` | Directory for Minecraft server files |
| `DATA_DIR` | `./data` | Panel database and config storage |
| `JAVA_PATH` | `java` | Path to Java binary |
| `MAX_SERVERS` | `10` | Maximum number of servers |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `ALLOWED_ORIGINS` | — | Comma-separated list of allowed CORS origins |

## First Run

On first launch, the panel presents an admin account setup screen. Create your admin username and password — this is the only account with full access by default.

## API

All endpoints are under `/api` (also available at `/api/v1`). Authentication is via JWT bearer token or API key.

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# List servers (with token)
curl http://localhost:3000/api/servers \
  -H "Authorization: Bearer <token>"
```

Key endpoint groups:
- `/api/auth` — Login, verify, password change, 2FA
- `/api/servers` — CRUD, start/stop/restart, command, suspend
- `/api/servers/:id/files` — File browser and editor
- `/api/servers/:id/plugins` — Plugin management
- `/api/servers/:id/backups` — Backup operations
- `/api/networks` — Proxy network management
- `/api/schedule` — Scheduled tasks
- `/api/stats` — System and per-server stats
- `/api/updates` — Version update status

## Development

```bash
git clone https://github.com/FortunasXP/FortunaPanel.git
cd FortunaPanel
npm install

# Start dev server (auto-restarts on changes)
npm run dev

# Watch CSS changes
npm run css:watch

# Run Electron in dev mode
npm run electron:dev

# Build production installer
npm run build
```

## Tech Stack

- **Backend:** Node.js, Express, WebSocket (ws)
- **Frontend:** Vanilla JS (ES modules), Tailwind CSS
- **Desktop:** Electron
- **Auth:** JWT + bcrypt + TOTP (otpauth)
- **Data:** JSON file storage (zero external databases)

## License

MIT

---

Built by [Fortuna](https://github.com/FortunasXP)
