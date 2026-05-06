# Feature Ideas

## Batch 1

### High Impact
- **Sub-user Accounts with Server Scoping** — Let users only see/manage specific servers assigned to them (right now roles are global)
- **Plugin Auto-updater** — Check Modrinth/CurseForge for plugin updates, one-click upgrade with rollback
- **Console Log Viewer** — Browse historical logs (already persisting to disk), with search/filter by level/date
- **Custom Alerts** — Configurable thresholds (TPS < 18, memory > 90%, player count drops to 0) that fire webhooks/notifications
- **World Management** — Switch between worlds, reset nether/end, download world as zip, seed display

### Medium Impact
- **Server Import** — Point at an existing server directory and import it into the panel
- **Mod/Plugin Conflict Checker** — Scan for known incompatibilities before starting
- **JVM Tuning Presets** — Aikar's flags, GraalVM flags, etc. as one-click profiles with explanations
- **Batch Operations** — Start/stop/restart/backup multiple servers at once
- **Server Groups & Tags** — Organize servers into categories (survival, creative, dev, production)

### Nice to Have
- **Dark/Light Theme Toggle** — The CSS tokens are already set up for it
- **PWA Support** — Service worker + manifest for mobile home screen install
- **Audit Log Export** — CSV/JSON download of activity history
- **Server Comparison** — Diff two server configs side-by-side
- **Startup Dependency Chains** — "Start lobby first, then survival, then creative" with delays

## Batch 2 — Infrastructure & Ops (Implemented in v1.2)

- **Snapshot & Rollback** — Full server state capture (world, plugins, configs) with instant restore
- **Docker Mode** — Run servers in isolated containers with resource limits and port mapping
- **Reverse Proxy Manager** — Built-in TCP proxy with configurable routing and live connection counts
- **Automatic SSL** — Let's Encrypt integration with auto-renewal + custom certificate upload
- **Remote Agents** — Multi-node support via lightweight agents connecting over WebSocket

## Batch 3 — Player Experience & Monitoring

- **Server Voting Integration** — Track votes from sites like PMC/MCSL, show leaderboards
- **MOTD Editor** — Visual editor with live preview, color codes, gradients, player count formatting
- **Whitelist/Ban GUI** — Manage whitelist.json and banned-players.json with bulk import, history, expiry
- **Player Analytics** — Playtime tracking, join/leave heatmaps, retention graphs, most active hours
- **Chat Bridge** — Discord ↔ Minecraft chat relay with configurable formatting

## Batch 4 — Developer & Power User

- **REST Webhook Builder** — Visual tool to build outgoing webhooks on any event
- **Scripting Engine** — User-defined automation scripts (JS) that react to events
- **Config File Editor** — Syntax-highlighted editor for server.properties, spigot.yml, paper-global.yml with validation
- **Git Integration** — Track config changes in git, diff history, revert individual files
- **API Playground** — Interactive docs page to test API calls against the panel

## Batch 5 — Quality of Life

- **Command Palette** — Ctrl+K quick search across servers, players, files, settings
- **Keyboard Shortcuts** — Navigate the panel without a mouse
- **Drag & Drop File Upload** — Drop files directly onto the file manager
- **Favorites & Pinned Servers** — Pin frequently accessed servers to the top
- **Disk Usage Breakdown** — Visual treemap of what's eating disk (worlds vs plugins vs logs vs backups)
