// FortunaPanel - Activity Log Page
import { api } from '../api.js';
import { app, showToast, showModal, escapeHtml } from '../app.js';

export function breadcrumbs() {
    return [{ label: 'Activity Log', href: '/activity' }];
}

const ACTION_ICONS = {
    'server.start': { icon: '&#9654;', class: 'text-foreground' },
    'server.stop': { icon: '&#9632;', class: 'text-muted-foreground' },
    'server.create': { icon: '+', class: 'text-foreground' },
    'server.delete': { icon: '&times;', class: 'text-foreground' },
    'server.crash': { icon: '&#9888;', class: 'text-foreground' },
    'server.max-crashes': { icon: '&#9888;', class: 'text-foreground' },
    'server.settings': { icon: '&#9881;', class: 'text-muted-foreground' },
    'server.import': { icon: '&#8615;', class: 'text-foreground' },
    'server.clone': { icon: '&#10697;', class: 'text-muted-foreground' },
    'server.suspend': { icon: '&#9888;', class: 'text-foreground' },
    'server.unsuspend': { icon: '&#9654;', class: 'text-foreground' },
    'server.reinstall': { icon: '&#8634;', class: 'text-foreground' },
    'plugin.install-remote': { icon: '&#8615;', class: 'text-foreground' },
    'player.join': { icon: '&#8594;', class: 'text-foreground' },
    'player.leave': { icon: '&#8592;', class: 'text-muted-foreground' },
    'player.kick': { icon: '!', class: 'text-foreground' },
    'player.ban': { icon: '&#x26d4;', class: 'text-foreground' },
    'backup.create': { icon: '&#128190;', class: 'text-muted-foreground' },
    'backup.restore': { icon: '&#8634;', class: 'text-foreground' },
    'backup.delete': { icon: '&#128465;', class: 'text-foreground' },
    'plugin.toggle': { icon: '&#9881;', class: 'text-muted-foreground' },
    'plugin.upload': { icon: '&#8593;', class: 'text-foreground' },
    'plugin.delete': { icon: '&times;', class: 'text-foreground' },
    'schedule.create': { icon: '&#128339;', class: 'text-muted-foreground' },
    'schedule.execute': { icon: '&#9654;', class: 'text-muted-foreground' },
    'config.change': { icon: '&#9881;', class: 'text-muted-foreground' },
    'auth.login': { icon: '&#128274;', class: 'text-muted-foreground' },
};

function getActionDisplay(action) {
    return ACTION_ICONS[action] || { icon: '&#8226;', class: 'text-muted-foreground/60' };
}

function formatAction(action) {
    const parts = action.split('.');
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function formatDetails(entry) {
    const d = entry.details;
    switch (entry.action) {
        case 'server.start':
        case 'server.stop':
            return d.serverName || d.serverId || '';
        case 'player.join':
        case 'player.leave':
            return `${d.player} on ${d.serverName || d.serverId}`;
        case 'player.kick':
        case 'player.ban':
            return `${d.player} from ${d.serverName || d.serverId}`;
        case 'backup.create':
            return `${d.serverName || d.serverId} (${formatSize(d.size)})`;
        case 'backup.restore':
            return `${d.filename} to ${d.serverName || d.serverId}`;
        case 'plugin.upload':
            return `${d.filename} to ${d.serverId}`;
        case 'plugin.toggle':
            return `${d.filename} ${d.enabled ? 'enabled' : 'disabled'}`;
        case 'schedule.execute':
            return `${d.name} (${d.type})`;
        default:
            return JSON.stringify(d).slice(0, 80);
    }
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

let currentFilter = null;
let currentOffset = 0;

export async function render(container) {
    currentFilter = null;
    currentOffset = 0;

    container.innerHTML = `
        <section class="space-y-6">
            <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                    <h1 class="page-title">Activity Log</h1>
                    <p class="mt-1 text-sm text-muted-foreground">Track all panel events and actions</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <select class="form-select text-xs" id="filterAction">
                        <option value="">All Events</option>
                        <option value="server">Server Events</option>
                        <option value="player">Player Events</option>
                        <option value="backup">Backup Events</option>
                        <option value="plugin">Plugin Events</option>
                        <option value="schedule">Scheduled Tasks</option>
                    </select>
                    <a href="/api/activity/export?format=json" class="btn btn-secondary btn-sm no-underline">Export JSON</a>
                    <a href="/api/activity/export?format=csv" class="btn btn-secondary btn-sm no-underline">Export CSV</a>
                    <button class="btn btn-secondary btn-sm" id="clearLog">Clear Log</button>
                </div>
            </div>
            <div id="activityList"></div>
            <div class="hidden py-5 text-center" id="loadMore">
                <button class="btn btn-secondary btn-sm" id="loadMoreBtn">Load More</button>
            </div>
        </section>
    `;

    container.querySelector('#filterAction')?.addEventListener('change', (e) => {
        currentFilter = e.target.value || null;
        currentOffset = 0;
        loadEntries(container, false);
    });

    container.querySelector('#clearLog')?.addEventListener('click', () => {
        showModal('Clear Activity Log', '<p>Are you sure you want to clear the entire activity log? This cannot be undone.</p>', [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'clear', label: 'Clear', class: 'btn-danger', onClick: async () => {
                try {
                    await api.del('/activity');
                    showToast('Activity log cleared', 'success');
                    loadEntries(container, false);
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });

    container.querySelector('#loadMoreBtn')?.addEventListener('click', () => {
        loadEntries(container, true);
    });

    await loadEntries(container, false);
}

async function loadEntries(container, append) {
    const list = container.querySelector('#activityList');
    const loadMore = container.querySelector('#loadMore');

    if (!append) {
        currentOffset = 0;
        list.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    }

    try {
        const params = new URLSearchParams({ limit: '50', offset: String(currentOffset) });
        if (currentFilter) params.set('action', currentFilter);

        const data = await api.get(`/activity?${params}`);
        const entries = data.entries || [];

        if (!append) list.innerHTML = '';

        if (entries.length === 0 && currentOffset === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="text-muted-foreground">
                            <polyline points="12 8 12 12 14 14"/>
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                    </div>
                    <h3>No activity yet</h3>
                    <p>Events will appear here as you use the panel.</p>
                </div>`;
            loadMore.classList.add('hidden');
            return;
        }

        const html = entries.map(entry => {
            const display = getActionDisplay(entry.action);
            const hasDiff = entry.diff && entry.diff.before && Object.keys(entry.diff.before).length > 0;
            return `
                <div class="activity-entry border-b border-border">
                    <div class="flex items-start gap-3.5 py-3 ${hasDiff ? 'cursor-pointer' : ''}" ${hasDiff ? `data-toggle-diff="${escapeHtml(String(entry.id))}"` : ''}>
                        <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card text-sm ${display.class}">${display.icon}</div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-semibold text-foreground">${formatAction(entry.action)}</span>
                                <span class="text-[11px] text-muted-foreground">${timeAgo(entry.timestamp)}</span>
                                ${hasDiff ? '<span class="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground">diff</span>' : ''}
                            </div>
                            <div class="mt-0.5 text-xs text-muted-foreground">${escapeHtml(formatDetails(entry))}</div>
                        </div>
                        <div class="flex-shrink-0 text-[11px] text-muted-foreground">${escapeHtml(entry.user || '')}</div>
                    </div>
                    ${hasDiff ? `
                        <div class="hidden pb-3 pl-11" id="diff-${escapeHtml(String(entry.id))}">
                            <div class="rounded-lg border border-border bg-card p-3 font-mono text-xs">
                                ${Object.keys(entry.diff.before).map(key => `
                                    <div class="mb-1">
                                        <span class="text-muted-foreground">${escapeHtml(key)}:</span>
                                        <span class="text-destructive line-through">${escapeHtml(JSON.stringify(entry.diff.before[key]))}</span>
                                        <span class="text-muted-foreground">&rarr;</span>
                                        <span class="text-foreground">${escapeHtml(JSON.stringify(entry.diff.after[key]))}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        if (append) {
            list.insertAdjacentHTML('beforeend', html);
        } else {
            list.innerHTML = html;
        }

        // Wire diff toggles. Use CSS.escape on the id segment so an entry
        // id containing CSS selector metacharacters can't break the
        // selector (or worse, target an unintended element).
        list.querySelectorAll('[data-toggle-diff]').forEach(el => {
            el.addEventListener('click', () => {
                const diffEl = list.querySelector(`#diff-${CSS.escape(el.dataset.toggleDiff)}`);
                if (diffEl) {
                    diffEl.classList.toggle('hidden');
                }
            });
        });

        currentOffset += entries.length;
        loadMore.classList.toggle('hidden', currentOffset >= data.total);
    } catch (e) {
        if (!append) {
            list.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
        }
    }
}

export function destroy() {
    currentFilter = null;
    currentOffset = 0;
}
