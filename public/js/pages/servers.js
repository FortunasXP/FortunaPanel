// FortunaPanel - Servers List Page
import { api } from '../api.js';
import { ws } from '../websocket.js';
import { app, showToast, showModal, escapeHtml } from '../app.js';

let serverStatusListener = null;
let serverStatsListener = null;
let containerRef = null;
let serversState = [];
let networkMapState = {};

export function breadcrumbs() {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Servers', href: '/servers' }
    ];
}

function statusDotClass(status) {
    if (status === 'running') return 'online';
    if (status === 'stopped') return 'offline';
    return 'starting';
}

function updateHeaderCounts() {
    if (!containerRef) return;
    const headerSub = containerRef.querySelector('[data-servers-summary]');
    if (!headerSub) return;
    const onlineServers = serversState.filter(s => s.status === 'running').length;
    const totalPlayers = serversState.reduce((sum, s) => sum + (s.players?.online || 0), 0);
    headerSub.textContent = `${serversState.length} server${serversState.length !== 1 ? 's' : ''} · ${onlineServers} running · ${totalPlayers} player${totalPlayers !== 1 ? 's' : ''}`;
}

function replaceServerCard(server) {
    if (!containerRef) return;
    const oldCard = containerRef.querySelector(`.server-card[data-id="${CSS.escape(server.id)}"]`);
    if (!oldCard) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderServerCard(server, networkMapState[server.id]);
    const newCard = wrapper.firstElementChild;
    oldCard.replaceWith(newCard);
    wireCard(newCard);
}

function wireCard(card) {
    card.addEventListener('click', (e) => {
        if (e.target.closest('[data-card-actions]')) return;
        app.navigate(`/server/${encodeURIComponent(card.dataset.id)}`);
    });
    card.querySelectorAll('.network-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            app.navigate(badge.getAttribute('href'));
        });
    });
    card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const serverId = btn.dataset.server;
            const action = btn.dataset.action;
            try {
                await api.post(`/servers/${encodeURIComponent(serverId)}/${action}`);
                showToast(`Server ${action} initiated`, 'success');
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });
}

export async function render(container) {
    containerRef = container;
    let servers = [];
    let networks = [];
    try {
        [servers, networks] = await Promise.all([
            api.get('/servers'),
            api.get('/networks').catch(() => [])
        ]);
    } catch (e) {
        // API not ready
    }
    serversState = servers;

    // Build server→network lookup
    const serverNetworkMap = {};
    for (const net of networks) {
        if (net.proxyId) {
            serverNetworkMap[net.proxyId] = { id: net.id, name: net.name, role: 'proxy' };
        }
        for (const bid of (net.backendIds || [])) {
            serverNetworkMap[bid] = { id: net.id, name: net.name, role: 'backend', alias: net.backendAliases?.[bid] };
        }
    }
    networkMapState = serverNetworkMap;

    const onlineServers = servers.filter(s => s.status === 'running').length;
    const totalPlayers = servers.reduce((sum, s) => sum + (s.players?.online || 0), 0);

    container.innerHTML = `
        <section class="space-y-6">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Servers</h1>
                    <p class="mt-1 text-sm text-muted-foreground" data-servers-summary>${servers.length} server${servers.length !== 1 ? 's' : ''} &middot; ${onlineServers} running &middot; ${totalPlayers} player${totalPlayers !== 1 ? 's' : ''}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${servers.length > 1 ? `
                    <div class="bulk-actions-bar hidden sm:flex">
                        <button class="btn btn-secondary" id="bulkStartAll" title="Start all stopped servers">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21"/></svg>
                            Start All
                        </button>
                        <button class="btn btn-secondary" id="bulkStopAll" title="Stop all running servers">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                            Stop All
                        </button>
                        <button class="btn btn-secondary" id="bulkRestartAll" title="Restart all running servers">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            Restart All
                        </button>
                    </div>
                    ` : ''}
                    <button class="btn btn-secondary" id="importServerBtn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Import
                    </button>
                    <button class="btn btn-primary" id="createServerBtn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New Server
                    </button>
                </div>
            </div>

            ${servers.length === 0 ? `
                <div class="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
                    <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                            <rect x="2" y="2" width="20" height="8" rx="2"/>
                            <rect x="2" y="14" width="20" height="8" rx="2"/>
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-semibold">No servers yet</h3>
                    <p class="mt-2 text-sm text-muted-foreground">Create your first Minecraft server to get started.</p>
                    <button class="btn btn-primary mt-5" id="createServerBtn2">Create Server</button>
                </div>
            ` : `
                <div class="server-grid" id="serverGrid">
                    ${servers.map(s => renderServerCard(s, serverNetworkMap[s.id])).join('')}
                </div>
            `}
        </section>
    `;

    // Wire create buttons
    container.querySelector('#createServerBtn')?.addEventListener('click', () => app.navigate('/create'));
    container.querySelector('#createServerBtn2')?.addEventListener('click', () => app.navigate('/create'));

    // Wire import button
    container.querySelector('#importServerBtn')?.addEventListener('click', () => showImportModal(container));

    // Wire bulk actions
    container.querySelector('#bulkStartAll')?.addEventListener('click', async () => {
        const stopped = serversState.filter(s => s.status === 'stopped');
        if (stopped.length === 0) { showToast('No stopped servers to start', 'info'); return; }
        showToast(`Starting ${stopped.length} server${stopped.length > 1 ? 's' : ''}...`, 'info');
        for (const s of stopped) {
            try { await api.post(`/servers/${encodeURIComponent(s.id)}/start`); }
            catch (e) { showToast(`Failed to start ${s.name || s.id}: ${e.message}`, 'error'); }
        }
    });
    container.querySelector('#bulkStopAll')?.addEventListener('click', async () => {
        const running = serversState.filter(s => s.status === 'running');
        if (running.length === 0) { showToast('No running servers to stop', 'info'); return; }
        showToast(`Stopping ${running.length} server${running.length > 1 ? 's' : ''}...`, 'info');
        for (const s of running) {
            try { await api.post(`/servers/${encodeURIComponent(s.id)}/stop`); }
            catch (e) { showToast(`Failed to stop ${s.name || s.id}: ${e.message}`, 'error'); }
        }
    });
    container.querySelector('#bulkRestartAll')?.addEventListener('click', async () => {
        const running = serversState.filter(s => s.status === 'running');
        if (running.length === 0) { showToast('No running servers to restart', 'info'); return; }
        showToast(`Restarting ${running.length} server${running.length > 1 ? 's' : ''}...`, 'info');
        for (const s of running) {
            try { await api.post(`/servers/${encodeURIComponent(s.id)}/restart`); }
            catch (e) { showToast(`Failed to restart ${s.name || s.id}: ${e.message}`, 'error'); }
        }
    });

    // Wire server cards
    container.querySelectorAll('.server-card').forEach(card => wireCard(card));

    // WebSocket: live status changes
    serverStatusListener = (data) => {
        if (!data || !data.serverId) return;
        const entry = serversState.find(s => s.id === data.serverId);
        if (!entry) return;
        entry.status = data.status;
        replaceServerCard(entry);
        updateHeaderCounts();
    };
    ws.on('server-status', serverStatusListener);

    // WebSocket: periodic stats (player counts + status snapshot)
    serverStatsListener = (msg) => {
        if (!msg || !msg.servers) return;
        for (const s of serversState) {
            const entry = msg.servers[s.id];
            if (!entry) continue;
            const statusChanged = s.status !== entry.status;
            const playersChanged = (s.players?.online || 0) !== (entry.players?.online || 0);
            s.status = entry.status;
            s.players = entry.players;
            if (statusChanged || playersChanged) replaceServerCard(s);
        }
        updateHeaderCounts();
    };
    ws.on('stats', serverStatsListener);
}

export function destroy() {
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
    networkMapState = {};
}

function showImportModal(container) {
    showModal('Import Existing Server', `
        <div class="form-group">
            <label class="form-label">Server Directory Path</label>
            <input type="text" class="form-input font-mono text-xs" id="importPath" placeholder="C:\\\\servers\\\\my-server">
            <div class="form-hint">Full path to the existing Minecraft server directory</div>
        </div>
        <div id="importPreview" class="mt-3 hidden rounded-lg border border-border bg-muted p-4">
            <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detected Configuration</div>
            <div id="importPreviewContent" class="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-xs"></div>
        </div>
        <div class="form-group mt-3">
            <label class="form-label">Server Name (optional)</label>
            <input type="text" class="form-input" id="importName" placeholder="Auto-detected from directory">
        </div>
    `, [
        { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
        { id: 'detect', label: 'Detect', class: 'btn-secondary', onClick: async () => {
            const path = document.querySelector('#importPath')?.value;
            if (!path) { showToast('Enter a directory path', 'error'); return; }
            try {
                const result = await api.post('/servers/import', { directory: path, detect: true });
                const d = result.detected;
                const preview = document.querySelector('#importPreview');
                const content = document.querySelector('#importPreviewContent');
                if (preview && content) {
                    preview.classList.remove('hidden');
                    content.innerHTML = `
                        <span class="text-muted-foreground">Type</span><span>${escapeHtml(d.type)}</span>
                        <span class="text-muted-foreground">JAR</span><span class="font-mono">${escapeHtml(d.jarFile || 'Not found')}</span>
                        <span class="text-muted-foreground">Version</span><span>${escapeHtml(d.version || 'Unknown')}</span>
                        <span class="text-muted-foreground">Port</span><span>${escapeHtml(d.port)}</span>
                        <span class="text-muted-foreground">Players</span><span>max ${escapeHtml(d.maxPlayers)}</span>
                        <span class="text-muted-foreground">EULA</span><span>${d.hasEula ? 'Accepted' : 'Not found'}</span>
                    `;
                }
            } catch (e) { showToast(e.message, 'error'); }
            return false;
        }},
        { id: 'import', label: 'Import', class: 'btn-primary', onClick: async () => {
            const directory = document.querySelector('#importPath')?.value;
            const name = document.querySelector('#importName')?.value;
            if (!directory) { showToast('Enter a directory path', 'error'); return; }
            try {
                const result = await api.post('/servers/import', { directory, name: name || undefined });
                showToast(`Server "${result.name}" imported successfully`, 'success');
                render(container);
            } catch (e) { showToast(e.message, 'error'); }
        }}
    ]);
}

function renderServerCard(server, networkInfo) {
    const status = server.status || 'stopped';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const typeRaw = (server.type || 'vanilla').toLowerCase();
    const type = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
    const isProxy = ['velocity', 'bungeecord', 'waterfall'].includes(typeRaw);
    const playersOnline = server.players?.online || 0;
    const playersMax = server.players?.max || 20;
    const port = server.port || 25565;
    const memory = server.memory?.max || '2G';

    const actionButtons = status === 'running'
        ? `<button class="btn btn-sm btn-secondary" data-action="restart" data-server="${escapeHtml(server.id)}" title="Restart">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
               Restart
           </button>
           <button class="btn btn-sm btn-danger" data-action="stop" data-server="${escapeHtml(server.id)}">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
               Stop
           </button>`
        : status === 'starting' || status === 'stopping'
        ? `<button class="btn btn-sm btn-secondary" disabled>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
               ${escapeHtml(statusLabel)}...
           </button>`
        : `<button class="btn btn-sm btn-primary" data-action="start" data-server="${escapeHtml(server.id)}">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 5 19 12 7 19"/></svg>
               Start
           </button>`;

    const proxyIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>`;
    const serverIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="7" rx="1.5"/><rect x="2" y="14" width="20" height="7" rx="1.5"/><circle cx="6.5" cy="6.5" r="0.75" fill="currentColor"/><circle cx="6.5" cy="17.5" r="0.75" fill="currentColor"/></svg>`;

    return `
        <article class="server-card motion-safe:motion-translate-y-in-1 motion-safe:motion-opacity-in-0 motion-safe:motion-duration-300" data-id="${escapeHtml(server.id)}" data-status="${escapeHtml(status)}" data-type="${escapeHtml(typeRaw)}">
            <div class="flex items-start gap-3 px-5 pt-4 pb-3 pl-6">
                <div class="server-type-icon">${isProxy ? proxyIcon : serverIcon}</div>
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <div class="flex min-w-0 items-center gap-2">
                        <h3 class="truncate text-sm font-semibold text-foreground">${escapeHtml(server.name)}</h3>
                    </div>
                    <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                        <span class="font-medium">${escapeHtml(type)}</span>
                        ${server.version ? `<span class="h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/40"></span><span>${escapeHtml(server.version)}</span>` : ''}
                        <span class="h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
                        <span class="font-mono text-muted-foreground/80">:${escapeHtml(port)}</span>
                    </div>
                </div>
                <span class="status-chip" data-status="${escapeHtml(status)}">
                    <span class="status-ping"></span>
                    ${escapeHtml(statusLabel)}
                </span>
            </div>

            ${networkInfo ? `
                <div class="px-5 pb-3 pl-6">
                    <a href="/network/${encodeURIComponent(networkInfo.id)}" class="server-network-badge network-badge">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/></svg>
                        <span class="truncate">${escapeHtml(networkInfo.name)}</span>
                        <span class="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">${networkInfo.role === 'proxy' ? 'proxy' : escapeHtml(networkInfo.alias || 'backend')}</span>
                    </a>
                </div>
            ` : ''}

            <div class="server-metric-strip">
                <div class="server-metric">
                    <div class="server-metric-value">
                        <span class="${playersOnline > 0 ? 'text-emerald-400' : ''}">${escapeHtml(playersOnline)}</span>
                        <span class="text-xs font-medium text-muted-foreground">/ ${escapeHtml(playersMax)}</span>
                    </div>
                    <div class="server-metric-label">Players</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-value font-mono">${escapeHtml(memory)}</div>
                    <div class="server-metric-label">Memory</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-value font-mono">${escapeHtml(port)}</div>
                    <div class="server-metric-label">Port</div>
                </div>
            </div>

            <div class="server-card-actions" data-card-actions>
                <div class="flex items-center gap-1.5">
                    ${actionButtons}
                </div>
                <svg class="server-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </div>
        </article>
    `;
}
