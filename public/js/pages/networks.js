// FortunaPanel - Networks List Page
import { api } from '../api.js';
import { ws } from '../websocket.js';
import { app, showToast, escapeHtml } from '../app.js';

let networkListener = null;
let statusListener = null;
let currentContainer = null;
let loadSeq = 0;
let refreshTimer = null;

export function breadcrumbs() {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Networks', href: '/networks' }
    ];
}

export async function render(container) {
    currentContainer = container;

    container.innerHTML = `
        <section class="space-y-6">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="page-title">Networks</h1>
                    <p class="mt-1 text-sm text-muted-foreground" id="networksSubtitle">Proxy networks linking a front-end proxy with backend servers</p>
                </div>
                <button class="btn btn-primary" id="newNetworkBtn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New Network
                </button>
            </div>
            <div id="networksList"><div class="page-loading"><div class="spinner"></div></div></div>
        </section>
    `;

    container.querySelector('#newNetworkBtn').addEventListener('click', () => app.navigate('/create-network'));

    await loadNetworks(container);

    // Listen for network events — debounced auto-refresh list
    const debouncedRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => loadNetworks(container), 300);
    };
    networkListener = debouncedRefresh;
    ws.on('network-created', networkListener);
    ws.on('network-deleted', networkListener);
    ws.on('network-status', networkListener);
    ws.on('network-backend-changed', networkListener);

    // Also refresh when individual server statuses change (affects network display)
    statusListener = debouncedRefresh;
    ws.on('server-status', statusListener);
}

async function loadNetworks(container) {
    const list = container.querySelector('#networksList');
    const subtitle = container.querySelector('#networksSubtitle');
    if (!list) return;

    const seq = ++loadSeq;
    try {
        const networks = await api.get('/networks');
        if (seq !== loadSeq) return;

        if (networks.length === 0) {
            if (subtitle) subtitle.textContent = 'Proxy networks linking a front-end proxy with backend servers';
            list.innerHTML = `
                <div class="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
                    <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
                            <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-semibold">No networks yet</h3>
                    <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Create a Velocity or BungeeCord proxy server first, then link it with backend servers to form a network.</p>
                    <div class="mt-5 flex items-center justify-center gap-2">
                        <button class="btn btn-secondary" id="emptyCreateProxy">Create Proxy Server</button>
                        <button class="btn btn-primary" id="emptyCreateNetwork">New Network</button>
                    </div>
                </div>`;

            list.querySelector('#emptyCreateProxy')?.addEventListener('click', () => app.navigate('/create'));
            list.querySelector('#emptyCreateNetwork')?.addEventListener('click', () => app.navigate('/create-network'));
            return;
        }

        const running = networks.filter(n => n.proxy?.status === 'running').length;
        const totalPlayers = networks.reduce((sum, n) => sum + (n.totalPlayers || 0), 0);
        if (subtitle) {
            subtitle.textContent = `${networks.length} network${networks.length !== 1 ? 's' : ''} · ${running} running · ${totalPlayers} player${totalPlayers !== 1 ? 's' : ''}`;
        }

        list.innerHTML = `
            <div class="server-grid">
                ${networks.map(n => renderNetworkCard(n)).join('')}
            </div>
        `;

        // Wire card clicks
        list.querySelectorAll('.server-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-card-actions]')) return;
                app.navigate(`/network/${card.dataset.id}`);
            });
        });

        // Wire quick actions
        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.closest('.server-card').dataset.id;
                const action = btn.dataset.action;
                const originalHtml = btn.innerHTML;
                try {
                    btn.disabled = true;
                    btn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                        ${action === 'start' ? 'Starting...' : 'Stopping...'}
                    `;
                    await api.post(`/networks/${id}/${action}`);
                    showToast(`Network ${action === 'start' ? 'starting' : 'stopping'}...`, 'success');
                    // WebSocket will trigger auto-refresh
                } catch (err) {
                    showToast(err.message, 'error');
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            });
        });
    } catch (err) {
        if (seq !== loadSeq) return;
        list.innerHTML = `
            <div class="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
                <h3 class="text-base font-semibold text-destructive">Failed to load networks</h3>
                <p class="mt-1 text-sm text-muted-foreground">${escapeHtml(err.message)}</p>
            </div>`;
    }
}

function renderNetworkCard(network) {
    const proxyStatus = network.proxy?.status || 'unknown';
    const statusLabel = proxyStatus.charAt(0).toUpperCase() + proxyStatus.slice(1);
    const typeRaw = (network.proxyType || 'velocity').toLowerCase();
    const typeLabel = typeRaw === 'velocity' ? 'Velocity' : typeRaw === 'bungeecord' ? 'BungeeCord' : typeRaw === 'waterfall' ? 'Waterfall' : typeRaw;

    const proxyName = network.proxy?.name || 'No proxy';
    const proxyPort = network.proxy?.port || '?';
    const backends = network.backends || [];
    const runningBackends = backends.filter(b => b.status === 'running').length;
    const totalPlayers = network.totalPlayers || 0;
    const isRunning = proxyStatus === 'running';
    const isTransient = proxyStatus === 'starting' || proxyStatus === 'stopping';

    // Backend mini-list (max 4 shown, rest as "+N more")
    const maxShown = 4;
    const shown = backends.slice(0, maxShown);
    const extra = Math.max(0, backends.length - maxShown);
    const backendRows = shown.map(b => {
        const bs = b.status || 'stopped';
        const name = b.alias || b.name || 'unknown';
        const players = b.players?.online || 0;
        return `
            <div class="flex min-w-0 items-center gap-2 text-xs">
                <span class="status-dot ${bs === 'running' ? 'online' : bs === 'stopped' ? 'offline' : 'starting'}" style="width:6px;height:6px;"></span>
                <span class="truncate text-foreground/80">${escapeHtml(name)}</span>
                ${b.isDefault ? '<span class="shrink-0 rounded border border-border/60 px-1 py-px text-[9px] uppercase tracking-wider text-muted-foreground">default</span>' : ''}
                <span class="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">:${escapeHtml(String(b.port || '?'))}</span>
                ${players > 0 ? `<span class="shrink-0 text-[11px] text-emerald-400">${players}p</span>` : ''}
            </div>
        `;
    }).join('');

    const actionButton = isTransient
        ? `<button class="btn btn-sm btn-secondary" disabled>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
               ${statusLabel}...
           </button>`
        : isRunning
        ? `<button class="btn btn-sm btn-danger" data-action="stop">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
               Stop All
           </button>`
        : `<button class="btn btn-sm btn-primary" data-action="start">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 5 19 12 7 19"/></svg>
               Start All
           </button>`;

    const proxyIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>`;

    return `
        <article class="server-card motion-safe:motion-translate-y-in-1 motion-safe:motion-opacity-in-0 motion-safe:motion-duration-300" data-id="${escapeHtml(network.id)}" data-status="${escapeHtml(proxyStatus)}" data-type="${escapeHtml(typeRaw)}">
            <div class="flex items-start gap-3 px-5 pt-4 pb-3 pl-6">
                <div class="server-type-icon">${proxyIcon}</div>
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <div class="flex min-w-0 items-center gap-2">
                        <h3 class="truncate text-sm font-semibold text-foreground">${escapeHtml(network.name)}</h3>
                    </div>
                    <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                        <span class="font-medium">${escapeHtml(typeLabel)}</span>
                        <span class="h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
                        <span class="truncate">${escapeHtml(proxyName)}</span>
                        <span class="h-0.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
                        <span class="font-mono text-muted-foreground/80">:${escapeHtml(String(proxyPort))}</span>
                    </div>
                </div>
                <span class="status-chip" data-status="${escapeHtml(proxyStatus)}">
                    <span class="status-ping"></span>
                    ${escapeHtml(statusLabel)}
                </span>
            </div>

            ${backends.length > 0 ? `
                <div class="border-t border-border/60 bg-muted/10 px-5 pl-6 py-2.5">
                    <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Backends · ${runningBackends}/${backends.length}</div>
                    <div class="space-y-1">
                        ${backendRows}
                        ${extra > 0 ? `<div class="text-[11px] text-muted-foreground/70">+${extra} more</div>` : ''}
                    </div>
                </div>
            ` : `
                <div class="border-t border-border/60 bg-muted/10 px-5 pl-6 py-3">
                    <div class="text-xs italic text-muted-foreground/70">No backends linked</div>
                </div>
            `}

            <div class="server-metric-strip">
                <div class="server-metric">
                    <div class="server-metric-value">
                        <span class="${totalPlayers > 0 ? 'text-emerald-400' : ''}">${totalPlayers}</span>
                    </div>
                    <div class="server-metric-label">Players</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-value font-mono">${backends.length}</div>
                    <div class="server-metric-label">Backends</div>
                </div>
                <div class="server-metric">
                    <div class="server-metric-value font-mono">${escapeHtml(String(proxyPort))}</div>
                    <div class="server-metric-label">Port</div>
                </div>
            </div>

            <div class="server-card-actions" data-card-actions>
                <div class="flex items-center gap-1.5">
                    ${actionButton}
                </div>
                <svg class="server-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </div>
        </article>
    `;
}

export function destroy() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (networkListener) {
        ws.off('network-created', networkListener);
        ws.off('network-deleted', networkListener);
        ws.off('network-status', networkListener);
        ws.off('network-backend-changed', networkListener);
        networkListener = null;
    }
    if (statusListener) {
        ws.off('server-status', statusListener);
        statusListener = null;
    }
    currentContainer = null;
}
