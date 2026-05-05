// FortunaPanel - Player Management Page
import { api } from '../api.js';
import { showToast, escapeHtml } from '../app.js';

let activeSubTab = 'online';
let serverId = null;
let playerData = null;
let whitelist = [];
let bans = [];
let ipBans = [];
let ops = [];

export function breadcrumbs(params) {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Server', href: `/server/${params.id}` },
        { label: 'Players', href: `/server/${params.id}/players` }
    ];
}

export async function render(container, params) {
    serverId = params.id;
    container.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        [playerData, whitelist, bans, ipBans, ops] = await Promise.all([
            api.get(`/servers/${serverId}/players`),
            api.get(`/servers/${serverId}/whitelist`).catch(() => []),
            api.get(`/servers/${serverId}/bans`).catch(() => []),
            api.get(`/servers/${serverId}/ip-bans`).catch(() => []),
            api.get(`/servers/${serverId}/ops`).catch(() => [])
        ]);

        renderPage(container);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function renderPage(container) {
    container.innerHTML = `
        <div class="mb-6">
            <h1 class="text-2xl font-semibold tracking-tight text-foreground">Player Management</h1>
            <p class="mt-0.5 text-xs text-muted-foreground">${playerData.count} of ${playerData.max} slots used</p>
        </div>
        <div class="tabs mb-6">
            <button class="tab ${activeSubTab === 'online' ? 'active' : ''}" data-subtab="online">Online <span class="ml-1 text-[11px] text-muted-foreground">${playerData.count}</span></button>
            <button class="tab ${activeSubTab === 'whitelist' ? 'active' : ''}" data-subtab="whitelist">Whitelist <span class="ml-1 text-[11px] text-muted-foreground">${whitelist.length}</span></button>
            <button class="tab ${activeSubTab === 'banned' ? 'active' : ''}" data-subtab="banned">Banned <span class="ml-1 text-[11px] text-muted-foreground">${bans.length}</span></button>
            <button class="tab ${activeSubTab === 'ip-bans' ? 'active' : ''}" data-subtab="ip-bans">IP Bans <span class="ml-1 text-[11px] text-muted-foreground">${ipBans.length}</span></button>
            <button class="tab ${activeSubTab === 'ops' ? 'active' : ''}" data-subtab="ops">Operators <span class="ml-1 text-[11px] text-muted-foreground">${ops.length}</span></button>
        </div>
        <div id="subTabContent" class="max-w-3xl"></div>
    `;

    // Wire sub-tabs
    container.querySelectorAll('[data-subtab]').forEach(tab => {
        tab.addEventListener('click', () => {
            activeSubTab = tab.dataset.subtab;
            renderPage(container);
        });
    });

    const content = container.querySelector('#subTabContent');
    switch (activeSubTab) {
        case 'online': renderOnlineTab(content, container); break;
        case 'whitelist': renderWhitelistTab(content, container); break;
        case 'banned': renderBannedTab(content, container); break;
        case 'ip-bans': renderIpBansTab(content, container); break;
        case 'ops': renderOpsTab(content, container); break;
    }
}

// ── Online Players ──

function renderOnlineTab(content, container) {
    content.innerHTML = `
        <div class="overflow-hidden rounded-lg border border-border bg-card">
            <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
                <span class="text-sm font-semibold text-foreground">Online Players</span>
                <span class="text-[11px] text-muted-foreground">${playerData.count}/${playerData.max}</span>
            </div>
            ${playerData.online.length === 0 ? `
                <div class="p-7 text-center text-xs text-muted-foreground">No players online</div>
            ` : `
                <div>
                    ${playerData.online.map(p => `
                        <div class="player-item">
                            <div class="player-info">
                                <img class="player-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(p)}/32" alt="${escapeHtml(p)}" loading="lazy">
                                <span class="player-name">${escapeHtml(p)}</span>
                            </div>
                            <div class="player-actions">
                                <button class="btn btn-sm btn-secondary" data-kick="${escapeHtml(p)}">Kick</button>
                                <button class="btn btn-sm btn-danger" data-ban="${escapeHtml(p)}">Ban</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;

    content.querySelectorAll('[data-kick]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/servers/${serverId}/players/kick`, { player: btn.dataset.kick });
                showToast(`Kicked ${btn.dataset.kick}`, 'success');
                setTimeout(() => render(container, { id: serverId }), 1000);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });

    content.querySelectorAll('[data-ban]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/servers/${serverId}/players/ban`, { player: btn.dataset.ban });
                showToast(`Banned ${btn.dataset.ban}`, 'success');
                setTimeout(() => render(container, { id: serverId }), 1000);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });
}

// ── Whitelist ──

function renderWhitelistTab(content, container) {
    content.innerHTML = `
        <div class="overflow-hidden rounded-lg border border-border bg-card">
            <div class="border-b border-border px-5 py-3.5">
                <span class="text-sm font-semibold text-foreground">Whitelist</span>
            </div>
            <div class="flex gap-2 border-b border-border px-5 py-3.5">
                <input type="text" class="form-input max-w-[200px] text-xs" id="whitelistInput" placeholder="Player name">
                <button class="btn btn-sm btn-secondary" id="whitelistAdd">Add</button>
            </div>
            ${whitelist.length === 0 ? `
                <div class="p-6 text-center text-xs text-muted-foreground">Whitelist is empty</div>
            ` : `
                <div>
                    ${whitelist.map(w => `
                        <div class="player-item">
                            <div class="player-info">
                                <img class="player-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(w.name)}/32" alt="${escapeHtml(w.name)}" loading="lazy">
                                <span class="player-name">${escapeHtml(w.name)}</span>
                            </div>
                            <button class="btn btn-sm btn-secondary" data-wl-remove="${escapeHtml(w.name)}">Remove</button>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;

    content.querySelector('#whitelistAdd')?.addEventListener('click', async () => {
        const input = content.querySelector('#whitelistInput');
        const player = input.value.trim();
        if (!player) return;
        try {
            await api.post(`/servers/${serverId}/whitelist/add`, { player });
            showToast(`Added ${player} to whitelist`, 'success');
            input.value = '';
            setTimeout(() => render(container, { id: serverId }), 1000);
        } catch (e) { showToast(e.message, 'error'); }
    });

    content.querySelector('#whitelistInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') content.querySelector('#whitelistAdd').click();
    });

    content.querySelectorAll('[data-wl-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/servers/${serverId}/whitelist/remove`, { player: btn.dataset.wlRemove });
                showToast(`Removed from whitelist`, 'success');
                setTimeout(() => render(container, { id: serverId }), 1000);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });
}

// ── Banned Players ──

function renderBannedTab(content, container) {
    content.innerHTML = `
        <div class="overflow-hidden rounded-lg border border-border bg-card">
            <div class="border-b border-border px-5 py-3.5">
                <span class="text-sm font-semibold text-foreground">Banned Players</span>
            </div>
            ${bans.length > 5 ? `
                <div class="border-b border-border px-5 py-3.5">
                    <input type="text" class="form-input text-xs" id="banSearch" placeholder="Search banned players...">
                </div>
            ` : ''}
            ${bans.length === 0 ? `
                <div class="p-6 text-center text-xs text-muted-foreground">No banned players</div>
            ` : `
                <div id="banList">
                    ${bans.map(b => `
                        <div class="player-item" data-search-name="${escapeHtml((b.name || '').toLowerCase())}">
                            <div class="player-info min-w-0 flex-1">
                                <img class="player-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(b.name || '')}/32" alt="${escapeHtml(b.name || '')}" loading="lazy">
                                <div class="min-w-0">
                                    <div class="player-name">${escapeHtml(b.name || 'Unknown')}</div>
                                    <div class="mt-0.5 text-[11px] text-muted-foreground">
                                        ${b.reason && b.reason !== 'Banned by an operator.' ? escapeHtml(b.reason) : ''}
                                        ${b.created ? `<span class="ml-1">${escapeHtml(formatBanDate(b.created))}</span>` : ''}
                                        ${b.source ? `<span class="ml-1">by ${escapeHtml(b.source)}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            <button class="btn btn-sm btn-secondary" data-pardon="${escapeHtml(b.name || '')}">Pardon</button>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;

    // Wire search
    content.querySelector('#banSearch')?.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        content.querySelectorAll('#banList .player-item').forEach(item => {
            item.classList.toggle('hidden', !item.dataset.searchName.includes(term));
        });
    });

    // Wire pardon
    content.querySelectorAll('[data-pardon]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/servers/${serverId}/players/pardon`, { player: btn.dataset.pardon });
                showToast(`Pardoned ${btn.dataset.pardon}`, 'success');
                setTimeout(() => render(container, { id: serverId }), 1000);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });
}

// ── IP Bans ──

function renderIpBansTab(content, container) {
    content.innerHTML = `
        <div class="overflow-hidden rounded-lg border border-border bg-card">
            <div class="border-b border-border px-5 py-3.5">
                <span class="text-sm font-semibold text-foreground">IP Bans</span>
            </div>
            <div class="flex gap-2 border-b border-border px-5 py-3.5">
                <input type="text" class="form-input max-w-[200px] text-xs" id="ipBanInput" placeholder="IP address">
                <button class="btn btn-sm btn-secondary" id="ipBanAdd">Ban IP</button>
            </div>
            ${ipBans.length === 0 ? `
                <div class="p-6 text-center text-xs text-muted-foreground">No IP bans</div>
            ` : `
                <div>
                    ${ipBans.map(b => `
                        <div class="player-item">
                            <div class="player-info min-w-0 flex-1">
                                <div>
                                    <div class="player-name font-mono text-xs">${escapeHtml(b.ip)}</div>
                                    <div class="mt-0.5 text-[11px] text-muted-foreground">
                                        ${b.reason && b.reason !== 'Banned by an operator.' ? escapeHtml(b.reason) : ''}
                                        ${b.created ? `<span class="ml-1">${escapeHtml(formatBanDate(b.created))}</span>` : ''}
                                        ${b.source ? `<span class="ml-1">by ${escapeHtml(b.source)}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            <button class="btn btn-sm btn-secondary" data-ip-pardon="${escapeHtml(b.ip)}">Pardon</button>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;

    content.querySelector('#ipBanAdd')?.addEventListener('click', async () => {
        const input = content.querySelector('#ipBanInput');
        const ip = input.value.trim();
        if (!ip) return;
        try {
            await api.post(`/servers/${serverId}/players/ban`, { player: ip });
            showToast(`Banned IP ${ip}`, 'success');
            input.value = '';
            setTimeout(() => render(container, { id: serverId }), 1000);
        } catch (e) { showToast(e.message, 'error'); }
    });

    content.querySelector('#ipBanInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') content.querySelector('#ipBanAdd').click();
    });

    content.querySelectorAll('[data-ip-pardon]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/servers/${serverId}/ip-bans/pardon`, { ip: btn.dataset.ipPardon });
                showToast(`Pardoned IP ${btn.dataset.ipPardon}`, 'success');
                setTimeout(() => render(container, { id: serverId }), 1000);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });
}

// ── Operators ──

function renderOpsTab(content, container) {
    content.innerHTML = `
        <div class="overflow-hidden rounded-lg border border-border bg-card">
            <div class="border-b border-border px-5 py-3.5">
                <span class="text-sm font-semibold text-foreground">Operators</span>
            </div>
            <div class="flex gap-2 border-b border-border px-5 py-3.5">
                <input type="text" class="form-input max-w-[200px] text-xs" id="opInput" placeholder="Player name">
                <button class="btn btn-sm btn-secondary" id="opAdd">Op</button>
            </div>
            ${ops.length === 0 ? `
                <div class="p-6 text-center text-xs text-muted-foreground">No operators</div>
            ` : `
                <div>
                    ${ops.map(o => `
                        <div class="player-item">
                            <div class="player-info">
                                <img class="player-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(o.name)}/32" alt="${escapeHtml(o.name)}" loading="lazy">
                                <div>
                                    <span class="player-name">${escapeHtml(o.name)}</span>
                                    <span class="ml-2 text-[11px] text-muted-foreground">Level ${escapeHtml(o.level || 4)}</span>
                                </div>
                            </div>
                            <button class="btn btn-sm btn-danger" data-deop="${escapeHtml(o.name)}">Deop</button>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;

    content.querySelector('#opAdd')?.addEventListener('click', async () => {
        const input = content.querySelector('#opInput');
        const player = input.value.trim();
        if (!player) return;
        try {
            await api.post(`/servers/${serverId}/ops/add`, { player });
            showToast(`Opped ${player}`, 'success');
            input.value = '';
            setTimeout(() => render(container, { id: serverId }), 1000);
        } catch (e) { showToast(e.message, 'error'); }
    });

    content.querySelector('#opInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') content.querySelector('#opAdd').click();
    });

    content.querySelectorAll('[data-deop]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/servers/${serverId}/ops/remove`, { player: btn.dataset.deop });
                showToast(`Deopped ${btn.dataset.deop}`, 'success');
                setTimeout(() => render(container, { id: serverId }), 1000);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });
}

// ── Helpers ──

function formatBanDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

export function destroy() {
    activeSubTab = 'online';
    serverId = null;
    playerData = null;
    whitelist = [];
    bans = [];
    ipBans = [];
    ops = [];
}
