// FortunaPanel - Dashboard Overview Page
import { api } from '../api.js';
import { ws } from '../websocket.js';
import { app, escapeHtml } from '../app.js';
import { drawChart as drawSharedChart, getCSSColor } from '../components/chart.js';

let statsListener = null;
let serverStatusListener = null;
let serverStatsListener = null;
let serversState = [];
let containerRef = null;

export function breadcrumbs() {
    return [{ label: 'Dashboard', href: '/' }];
}

function statusClasses(status) {
    if (status === 'running') return 'online';
    if (status === 'stopped') return 'offline';
    return 'starting';
}

function updateServerRow(server) {
    if (!containerRef) return;
    const row = containerRef.querySelector(`.server-list-item[data-id="${CSS.escape(server.id)}"]`);
    if (!row) return;
    const status = server.status || 'stopped';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

    row.dataset.status = status;

    const chip = row.querySelector('.status-chip');
    if (chip) {
        chip.setAttribute('data-status', status);
        const ping = chip.querySelector('.status-ping');
        chip.textContent = ` ${statusLabel}`;
        if (ping) chip.insertBefore(ping, chip.firstChild);
        else {
            const span = document.createElement('span');
            span.className = 'status-ping';
            chip.insertBefore(span, chip.firstChild);
        }
    }

    const dot = row.querySelector('.status-dot');
    if (dot) dot.className = `status-dot ${statusClasses(status)}`;

    const accent = row.querySelector('.absolute.inset-y-2');
    if (accent) {
        accent.className = `absolute inset-y-2 left-0 w-[2px] rounded-r-full transition-all duration-300 ${
            status === 'running' ? 'bg-emerald-500 opacity-100'
            : status === 'starting' || status === 'stopping' ? 'bg-amber-400 opacity-100'
            : 'opacity-0'
        }`;
    }

    const playersEl = row.querySelector('[data-players]');
    if (playersEl) {
        const count = server.players?.online ?? 0;
        playersEl.textContent = String(count);
        playersEl.className = count > 0 ? 'text-emerald-400 font-medium' : '';
    }
}

export async function render(container) {
    containerRef = container;
    let servers = [];
    let stats = null;

    try {
        [servers, stats] = await Promise.all([
            api.get('/servers'),
            api.get('/stats').catch(() => null)
        ]);
    } catch (e) {
        // API not ready
    }
    serversState = servers;

    const totalPlayers = servers.reduce((sum, s) => sum + (s.players?.online || 0), 0);
    const onlineServers = servers.filter(s => s.status === 'running').length;
    const cpuPercent = stats?.system?.cpu?.current || 0;
    const memPercent = stats?.system?.memory?.current || 0;
    const memUsed = stats?.system?.memory?.used || 0;
    const memTotal = stats?.system?.memory?.total || 0;
    const uptime = stats?.system?.uptime || 0;

    container.innerHTML = `
        <section class="space-y-6">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>
                    <p class="mt-1 text-sm text-muted-foreground">System overview and server status</p>
                </div>
                <button class="btn btn-primary" id="createServerBtn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New Server
                </button>
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50">
                    <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">CPU Usage</p>
                    <p class="mt-2 text-3xl font-bold tracking-tight" id="cpuValue">${cpuPercent}%</p>
                    <p class="mt-1 text-xs text-muted-foreground">${escapeHtml(stats?.system?.cpu?.cores ?? '?')} cores</p>
                </div>
                <div class="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50">
                    <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Memory</p>
                    <p class="mt-2 text-3xl font-bold tracking-tight" id="memValue">${memPercent}%</p>
                    <p class="mt-1 text-xs text-muted-foreground" id="memSub">${formatBytes(memUsed)} / ${formatBytes(memTotal)}</p>
                </div>
                <div class="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50">
                    <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Servers</p>
                    <p class="mt-2 text-3xl font-bold tracking-tight" id="serverCount">${servers.length}</p>
                    <p class="mt-1 text-xs text-muted-foreground"><span id="onlineCount">${onlineServers}</span> running</p>
                </div>
                <div class="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50">
                    <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Players</p>
                    <p class="mt-2 text-3xl font-bold tracking-tight" id="totalPlayers">${totalPlayers}</p>
                    <p class="mt-1 text-xs text-muted-foreground">across all servers</p>
                </div>
            </div>

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div class="rounded-lg border border-border bg-card p-5">
                    <div class="mb-3 flex items-center justify-between">
                        <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">CPU Usage</span>
                        <span class="font-mono text-xs text-foreground" id="cpuChartValue">${cpuPercent}%</span>
                    </div>
                    <canvas id="cpuChart" class="chart-canvas"></canvas>
                </div>
                <div class="rounded-lg border border-border bg-card p-5">
                    <div class="mb-3 flex items-center justify-between">
                        <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Memory Usage</span>
                        <span class="font-mono text-xs text-foreground" id="memChartValue">${memPercent}%</span>
                    </div>
                    <canvas id="memChart" class="chart-canvas"></canvas>
                </div>
            </div>

            <div class="flex items-center justify-between">
                <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Server Status</h2>
                <a href="/servers" class="text-xs text-muted-foreground transition-colors hover:text-foreground" id="viewAllServers">View all &rarr;</a>
            </div>

            ${servers.length === 0 ? `
                <div class="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
                    <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-semibold">No servers yet</h3>
                    <p class="mt-2 text-sm text-muted-foreground">Create your first Minecraft server to get started.</p>
                    <button class="btn btn-primary mt-5" id="createServerBtn2">Create Server</button>
                </div>
            ` : `
                <div class="overflow-hidden rounded-lg border border-border bg-card">
                    ${servers.map((s) => {
                        const status = s.status || 'stopped';
                        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
                        const typeRaw = (s.type || 'vanilla').toLowerCase();
                        const type = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
                        const playersOnline = s.players?.online || 0;
                        return `
                            <div class="server-list-item group relative flex cursor-pointer items-center justify-between gap-3 border-b border-border px-4 py-3 transition-all duration-200 hover:bg-accent/40 last:border-b-0" data-id="${escapeHtml(s.id)}" data-status="${escapeHtml(status)}">
                                <div class="absolute inset-y-2 left-0 w-[2px] rounded-r-full transition-all duration-300 ${status === 'running' ? 'bg-emerald-500 opacity-100' : status === 'starting' || status === 'stopping' ? 'bg-amber-400 opacity-100' : 'opacity-0'}"></div>
                                <div class="flex min-w-0 flex-1 items-center gap-3">
                                    <span class="status-dot ${statusClasses(status)}"></span>
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-sm font-medium">${escapeHtml(s.name)}</div>
                                        <div class="truncate text-xs text-muted-foreground">
                                            <span>${escapeHtml(type)}</span>
                                            ${s.version ? ` &middot; ${escapeHtml(s.version)}` : ''}
                                            <span class="mx-1 opacity-40">&middot;</span>
                                            <span class="font-mono">:${escapeHtml(s.port || 25565)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="ml-3 flex items-center gap-4">
                                    <span class="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="opacity-70"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                        <span data-players class="${playersOnline > 0 ? 'text-emerald-400 font-medium' : ''}">${playersOnline}</span>
                                    </span>
                                    <span class="status-chip" data-status="${escapeHtml(status)}">
                                        <span class="status-ping"></span>
                                        ${escapeHtml(statusLabel)}
                                    </span>
                                    <svg class="h-4 w-4 text-muted-foreground/50 transition-all group-hover:text-foreground group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `}

            <div class="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-5 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                <div><span class="text-muted-foreground/60">Hostname:</span> ${escapeHtml(stats?.system?.hostname || 'Unknown')}</div>
                <div><span class="text-muted-foreground/60">Platform:</span> ${escapeHtml(stats?.system?.platform || 'Unknown')}</div>
                <div><span class="text-muted-foreground/60">Node.js:</span> ${escapeHtml(stats?.system?.nodeVersion || '?')}</div>
                <div><span class="text-muted-foreground/60">Uptime:</span> <span id="uptimeValue">${formatUptime(uptime)}</span></div>
            </div>
        </section>
    `;

    // Draw initial charts
    const cpuHistory = stats?.system?.cpu?.history || [];
    const memHistory = stats?.system?.memory?.history || [];
    drawChart('cpuChart', cpuHistory, getCSSColor('--chart-1', '#3b82f6'));
    drawChart('memChart', memHistory, getCSSColor('--chart-2', '#a855f7'));

    // Subscribe to real-time stats
    ws.subscribeStats();
    statsListener = (data) => {
        if (data.system) {
            const cpuEl = container.querySelector('#cpuValue');
            const memEl = container.querySelector('#memValue');
            const memSub = container.querySelector('#memSub');
            const cpuChartVal = container.querySelector('#cpuChartValue');
            const memChartVal = container.querySelector('#memChartValue');

            if (cpuEl) cpuEl.textContent = `${data.system.cpu.current}%`;
            if (memEl) memEl.textContent = `${data.system.memory.current}%`;
            if (memSub) memSub.textContent = `${formatBytes(data.system.memory.used)} / ${formatBytes(data.system.memory.total)}`;
            if (cpuChartVal) cpuChartVal.textContent = `${data.system.cpu.current}%`;
            if (memChartVal) memChartVal.textContent = `${data.system.memory.current}%`;

            drawChart('cpuChart', data.system.cpu.history, getCSSColor('--chart-1', '#3b82f6'));
            drawChart('memChart', data.system.memory.history, getCSSColor('--chart-2', '#a855f7'));
        }
    };
    ws.on('system-stats', statsListener);

    // Subscribe to server-status to update row chips/dots/accents live
    serverStatusListener = (data) => {
        if (!data || !data.serverId) return;
        const entry = serversState.find(s => s.id === data.serverId);
        if (entry) entry.status = data.status;
        updateServerRow(entry || { id: data.serverId, status: data.status });

        // Recompute onlineCount
        const onlineEl = container.querySelector('#onlineCount');
        if (onlineEl) {
            const running = serversState.filter(s => s.status === 'running').length;
            onlineEl.textContent = String(running);
        }
    };
    ws.on('server-status', serverStatusListener);

    // Subscribe to periodic stats (player counts)
    serverStatsListener = (msg) => {
        if (!msg || !msg.servers) return;
        let total = 0;
        for (const s of serversState) {
            const entry = msg.servers[s.id];
            if (entry) {
                s.status = entry.status;
                s.players = entry.players;
                updateServerRow(s);
            }
            total += s.players?.online || 0;
        }
        const totalEl = container.querySelector('#totalPlayers');
        if (totalEl) totalEl.textContent = String(total);
    };
    ws.on('stats', serverStatsListener);

    // Wire navigation
    container.querySelector('#createServerBtn')?.addEventListener('click', () => app.navigate('/create'));
    container.querySelector('#createServerBtn2')?.addEventListener('click', () => app.navigate('/create'));
    container.querySelector('#viewAllServers')?.addEventListener('click', (e) => {
        e.preventDefault();
        app.navigate('/servers');
    });

    container.querySelectorAll('.server-list-item').forEach(item => {
        item.addEventListener('click', () => app.navigate(`/server/${encodeURIComponent(item.dataset.id)}`));
    });
}

export function destroy() {
    if (statsListener) {
        ws.off('system-stats', statsListener);
        statsListener = null;
    }
    if (serverStatusListener) {
        ws.off('server-status', serverStatusListener);
        serverStatusListener = null;
    }
    if (serverStatsListener) {
        ws.off('stats', serverStatsListener);
        serverStatsListener = null;
    }
    containerRef = null;
    serversState = [];
}

function drawChart(canvasId, data, color) {
    drawSharedChart(canvasId, data, color, { maxValue: 100 });
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatUptime(seconds) {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.join(' ') || '< 1m';
}
