// FortunaPanel - Network Detail Page
import { api } from '../api.js';
import { ws } from '../websocket.js';
import { app, showToast, showModal, escapeHtml } from '../app.js';

let network = null;
let currentTab = 'overview';
let secretVisible = false;
let networkListener = null;
let backendListener = null;
let statusListener = null;
let healthListener = null;
let maintenanceListener = null;
let rollingRestartListener = null;

export function breadcrumbs(params) {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Networks', href: '/networks' },
        { label: network?.name || 'Network', href: `/network/${params.id}` }
    ];
}

export async function render(container, params) {
    try {
        network = await api.get(`/networks/${params.id}`);
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><h3>Network not found</h3><p>${escapeHtml(err.message)}</p></div>`;
        return;
    }

    renderPage(container, params);

    // Real-time updates via WebSocket (debounced to avoid rapid re-renders)
    let refreshTimer = null;
    const refresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            try {
                network = await api.get(`/networks/${params.id}`);
                renderPage(container, params);
            } catch (e) { /* network may have been deleted */ }
        }, 300);
    };

    networkListener = (data) => {
        if (data.networkId === params.id) refresh();
    };
    ws.on('network-status', networkListener);

    backendListener = (data) => {
        if (data.networkId === params.id) refresh();
    };
    ws.on('network-backend-changed', backendListener);

    // Refresh when any server in this network changes status
    statusListener = (data) => {
        if (!network) return;
        const isInNetwork = data.serverId === network.proxyId ||
            (network.backendIds || []).includes(data.serverId);
        if (isInNetwork) refresh();
    };
    ws.on('server-status', statusListener);

    // Health, maintenance, rolling restart events
    healthListener = (data) => {
        if (!network) return;
        const isInNetwork = (network.backendIds || []).includes(data.serverId);
        if (isInNetwork) refresh();
    };
    ws.on('health-changed', healthListener);

    maintenanceListener = (data) => {
        if (data.networkId === params.id) refresh();
    };
    ws.on('maintenance-changed', maintenanceListener);

    rollingRestartListener = (data) => {
        if (data.networkId === params.id) {
            if (data.type === 'rolling-restart-completed') refresh();
            else if (data.type === 'rolling-restart-progress') {
                showToast(`Rolling restart: ${data.current}/${data.total} — ${data.serverName || data.serverId}`, 'info');
            }
        }
    };
    ws.on('rolling-restart-started', rollingRestartListener);
    ws.on('rolling-restart-progress', rollingRestartListener);
    ws.on('rolling-restart-completed', rollingRestartListener);
}

function renderPage(container, params) {
    if (!network.backends) network.backends = [];
    if (!network.proxy) network.proxy = { status: 'unknown', missing: true };
    const proxyStatus = network.proxy?.status || 'unknown';
    const typeBadge = network.proxyType === 'velocity' ? 'Velocity' : 'BungeeCord';

    container.innerHTML = `
        <div class="page-header mb-6">
            <div class="flex items-center gap-3">
                <h1 class="page-title font-semibold">${escapeHtml(network.name)}</h1>
                <span class="proxy-type-badge border-border bg-muted text-foreground">${typeBadge}</span>
                <span class="status-dot status-${proxyStatus}"></span>
            </div>
            <div class="page-actions">
                ${proxyStatus === 'running'
                    ? `<button class="btn btn-secondary" id="stopNetworkBtn">Stop Network</button>`
                    : `<button class="btn btn-primary" id="startNetworkBtn">Start Network</button>`
                }
            </div>
        </div>
        <div class="tabs mb-6">
            <button class="tab ${currentTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
            <button class="tab ${currentTab === 'servers' ? 'active' : ''}" data-tab="servers">Servers</button>
            <button class="tab ${currentTab === 'config' ? 'active' : ''}" data-tab="config">Config</button>
            <button class="tab ${currentTab === 'dns' ? 'active' : ''}" data-tab="dns">DNS</button>
            <button class="tab ${currentTab === 'health' ? 'active' : ''}" data-tab="health">Health</button>
            <button class="tab ${currentTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
        </div>
        <div id="tabContent"></div>
    `;

    // Wire tabs
    container.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentTab = tab.dataset.tab;
            renderPage(container, params);
        });
    });

    // Wire start/stop with loading states
    container.querySelector('#startNetworkBtn')?.addEventListener('click', async () => {
        const btn = container.querySelector('#startNetworkBtn');
        btn.disabled = true;
        btn.textContent = 'Starting...';
        try {
            await api.post(`/networks/${network.id}/start`);
            showToast('Network starting...', 'success');
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Start Network';
        }
    });
    container.querySelector('#stopNetworkBtn')?.addEventListener('click', async () => {
        const btn = container.querySelector('#stopNetworkBtn');
        btn.disabled = true;
        btn.textContent = 'Stopping...';
        try {
            await api.post(`/networks/${network.id}/stop`);
            showToast('Network stopping...', 'success');
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Stop Network';
        }
    });

    // Render tab content
    const tabContent = container.querySelector('#tabContent');
    switch (currentTab) {
        case 'overview': renderOverview(tabContent, container, params); break;
        case 'servers': renderServers(tabContent, container, params); break;
        case 'config': renderConfig(tabContent); break;
        case 'dns': renderDns(tabContent, container, params); break;
        case 'health': renderHealth(tabContent, container, params); break;
        case 'settings': renderSettings(tabContent, container, params); break;
    }
}

function renderOverview(el, container, params) {
    const proxy = network.proxy || {};
    const backends = network.backends || [];

    // Build health dot helper
    const healthDot = (b) => {
        const h = b.health;
        if (!h || h.status === 'unknown') return '';
        const color = h.status === 'healthy' ? '#e4e4e7' : '#71717a';
        return `<span class="ml-1 inline-block h-1.5 w-1.5 rounded-full" style="background:${color}" title="Health: ${h.status}"></span>`;
    };

    el.innerHTML = `
        <div class="network-topology">
            <div class="network-node network-node-proxy border-border bg-card">
                <div class="mb-1 flex items-center gap-2">
                    <span class="status-dot status-${proxy.status || 'unknown'}"></span>
                    <strong>${escapeHtml(proxy.name || 'Proxy')}</strong>
                </div>
                <div class="text-xs text-muted-foreground">
                    ${network.proxyType} &middot; port ${proxy.port || '?'} &middot; ${proxy.players?.online || 0} players
                </div>
                <a href="/server/${network.proxyId}" class="network-node-link">View Server</a>
            </div>
            ${backends.length > 0 ? `
                <div class="network-edges">
                    ${backends.map(() => '<div class="network-edge"></div>').join('')}
                </div>
                <div class="network-backends">
                    ${backends.map(b => `
                        <div class="network-node network-node-backend border-border bg-card${b.maintenance?.enabled ? ' network-node-maintenance' : ''}">
                            <div class="mb-1 flex items-center gap-2">
                                <span class="status-dot status-${b.status || 'unknown'}"></span>
                                <strong>${escapeHtml(b.alias || b.name || 'unknown')}</strong>
                                ${healthDot(b)}
                                ${b.isDefault ? '<span class="text-[10px] text-muted-foreground">(default)</span>' : ''}
                                ${b.maintenance?.enabled ? '<span class="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">maintenance</span>' : ''}
                            </div>
                            <div class="text-xs text-muted-foreground">
                                ${escapeHtml(b.type || '?')} &middot; port ${b.port || '?'} &middot; ${b.players?.online || 0} players
                            </div>
                            <a href="/server/${b.id}" class="network-node-link">View Server</a>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <div class="mt-6 text-center text-sm text-muted-foreground">
                    No backend servers linked. Go to the Servers tab to add backends.
                </div>
            `}
        </div>
        <div class="grid-3 mt-8">
            <div class="mini-stat">
                <div class="mini-stat-label">Total Players</div>
                <div class="mini-stat-value">${network.totalPlayers || 0}</div>
            </div>
            <div class="mini-stat">
                <div class="mini-stat-label">Backend Servers</div>
                <div class="mini-stat-value">${backends.length}</div>
            </div>
            <div class="mini-stat">
                <div class="mini-stat-label">Status</div>
                <div class="mini-stat-value">${network.allRunning ? 'All Online' : proxy.status === 'running' ? 'Partial' : 'Offline'}</div>
            </div>
        </div>
    `;

    // Wire node links
    el.querySelectorAll('.network-node-link').forEach(link => {
        link.addEventListener('click', (e) => { e.preventDefault(); app.navigate(link.getAttribute('href')); });
    });
}

function renderServers(el, container, params) {
    const backends = network.backends || [];

    el.innerHTML = `
        <div class="mb-4 flex items-center justify-between">
            <h3 class="text-base font-medium text-foreground">Backend Servers (${backends.length})</h3>
            <button class="btn btn-primary text-xs" id="addBackendBtn">Add Server</button>
        </div>
        ${backends.length === 0 ? `
            <div class="empty-state-dashed">
                No backend servers linked to this network yet.
            </div>
        ` : `
            <div class="card card-flush">
                ${backends.map(b => {
                    const inMaintenance = b.maintenance?.enabled;
                    return `
                    <div class="list-item px-5 py-4">
                        <div class="flex items-center gap-3">
                            <span class="status-dot status-${b.status || 'unknown'}"></span>
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="font-medium">${escapeHtml(b.alias || b.name || 'unknown')}</span>
                                    ${b.isDefault ? '<span class="text-[11px] text-muted-foreground">(default)</span>' : ''}
                                    ${inMaintenance ? '<span class="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">maintenance</span>' : ''}
                                </div>
                                <div class="text-xs text-muted-foreground">${escapeHtml(b.name || '?')} &middot; port ${b.port || '?'} &middot; ${b.players?.online || 0} players</div>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button class="btn btn-sm ${inMaintenance ? 'btn-primary' : 'btn-secondary'}" data-maintenance="${b.id}" title="${inMaintenance ? 'Disable maintenance' : 'Enable maintenance'}">${inMaintenance ? 'Exit Maintenance' : 'Maintenance'}</button>
                            ${!b.isDefault ? `<button class="btn btn-sm btn-secondary" data-set-default="${b.id}">Set Default</button>` : ''}
                            <button class="btn btn-sm btn-danger" data-remove="${b.id}">Remove</button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        `}
    `;

    // Wire add backend
    el.querySelector('#addBackendBtn').addEventListener('click', () => showAddBackendModal(container, params));

    // Wire maintenance toggle
    el.querySelectorAll('[data-maintenance]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const serverId = btn.dataset.maintenance;
            const backend = backends.find(b => b.id === serverId);
            const isEnabled = backend?.maintenance?.enabled;
            try {
                await api.post(`/networks/${network.id}/maintenance/${serverId}`, {
                    enabled: !isEnabled,
                    reason: !isEnabled ? 'Manual maintenance' : undefined
                });
                showToast(isEnabled ? 'Maintenance disabled' : 'Maintenance enabled', 'success');
                network = await api.get(`/networks/${network.id}`);
                renderPage(container, params);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });

    // Wire set default
    el.querySelectorAll('[data-set-default]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/networks/${network.id}/default`, { serverId: btn.dataset.setDefault });
                showToast('Default server updated', 'success');
                network = await api.get(`/networks/${network.id}`);
                renderPage(container, params);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });

    // Wire remove
    el.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.del(`/networks/${network.id}/backends/${btn.dataset.remove}`);
                showToast('Backend removed', 'success');
                network = await api.get(`/networks/${network.id}`);
                renderPage(container, params);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
}

async function showAddBackendModal(container, params) {
    try {
        const allServers = await api.get('/servers');
        const networks = await api.get('/networks');

        // Filter: exclude proxy types and servers already in any network
        const linkedServerIds = new Set();
        for (const net of networks) {
            linkedServerIds.add(net.proxyId);
            for (const bid of (net.backendIds || [])) linkedServerIds.add(bid);
        }

        const available = allServers.filter(s =>
            !['velocity', 'bungeecord'].includes(s.type) && !linkedServerIds.has(s.id)
        );

        if (available.length === 0) {
            showToast('No available servers to add. Create a new server first.', 'info');
            return;
        }

        const body = `
            <div class="form-group">
                <label class="form-label">Select Server</label>
                <select class="form-select" id="backendServerSelect">
                    ${available.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.type)}, port ${s.port})</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Alias</label>
                <input type="text" class="form-input" id="backendAlias" placeholder="e.g. lobby, survival, creative">
                <div class="form-hint">Short name used in proxy config. Letters, numbers, underscores, hyphens only.</div>
            </div>
        `;

        showModal('Add Backend Server', body, [
            {
                id: 'add', label: 'Add Server', class: 'btn-primary',
                onClick: async () => {
                    const serverId = document.querySelector('#backendServerSelect').value;
                    const alias = document.querySelector('#backendAlias').value;
                    try {
                        await api.post(`/networks/${network.id}/backends`, { serverId, alias });
                        showToast('Backend added', 'success');
                        network = await api.get(`/networks/${network.id}`);
                        renderPage(container, params);
                    } catch (err) { showToast(err.message, 'error'); }
                }
            }
        ]);
    } catch (err) {
        showToast('Failed to load servers: ' + err.message, 'error');
    }
}

function renderConfig(el) {
    const configContent = network.configContent || 'No config file generated yet.';
    const configFile = network.proxyType === 'velocity' ? 'velocity.toml' : 'config.yml';
    const maskedSecret = '\u2022'.repeat(24);

    el.innerHTML = `
        <div class="settings-card mb-4">
            <div class="settings-card-header settings-card-header-row">
                <div>
                    <h2 class="settings-card-title">${configFile}</h2>
                    <p class="settings-card-desc">Manual edits to the servers section will be overwritten on sync.</p>
                </div>
                <button class="btn btn-secondary btn-sm" id="syncConfigBtn">Sync Config</button>
            </div>
            <div class="settings-card-body">
                <pre class="max-h-[400px] overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 font-mono text-xs">${escapeHtml(configContent)}</pre>
            </div>
        </div>
        <div class="settings-card">
            <div class="settings-card-header">
                <h2 class="settings-card-title">Forwarding Secret</h2>
                <p class="settings-card-desc">This secret must match between the proxy and all backend servers.</p>
            </div>
            <div class="settings-card-body">
                <div class="flex items-center gap-2">
                    <code id="secretDisplay" class="flex-1 overflow-hidden text-ellipsis rounded-md bg-muted px-2.5 py-1.5 text-xs ${secretVisible ? 'select-auto' : 'select-none'}">${secretVisible ? escapeHtml(network.forwardingSecret || 'N/A') : maskedSecret}</code>
                    <button class="btn btn-secondary btn-sm" id="toggleSecretBtn">${secretVisible ? 'Hide' : 'Show'}</button>
                    <button class="btn btn-secondary btn-sm" id="copySecretBtn">Copy</button>
                    <button class="btn btn-secondary btn-sm" id="regenSecretBtn">Regenerate</button>
                </div>
            </div>
        </div>
    `;

    el.querySelector('#syncConfigBtn').addEventListener('click', async () => {
        const btn = el.querySelector('#syncConfigBtn');
        btn.disabled = true;
        btn.textContent = 'Syncing...';
        try {
            await api.post(`/networks/${network.id}/sync`);
            showToast('Configs synced', 'success');
            network = await api.get(`/networks/${network.id}`);
            renderConfig(el);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Sync Config';
        }
    });

    el.querySelector('#toggleSecretBtn').addEventListener('click', () => {
        secretVisible = !secretVisible;
        const display = el.querySelector('#secretDisplay');
        const btn = el.querySelector('#toggleSecretBtn');
        if (secretVisible) {
            display.textContent = network.forwardingSecret || 'N/A';
            display.classList.remove('select-none');
            display.classList.add('select-auto');
            btn.textContent = 'Hide';
        } else {
            display.textContent = maskedSecret;
            display.classList.remove('select-auto');
            display.classList.add('select-none');
            btn.textContent = 'Show';
        }
    });

    el.querySelector('#copySecretBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(network.forwardingSecret);
        showToast('Secret copied to clipboard', 'success');
    });

    el.querySelector('#regenSecretBtn').addEventListener('click', () => {
        showModal('Regenerate Secret', `
            <p class="mb-2">Regenerate the forwarding secret for <strong>${escapeHtml(network.name)}</strong>?</p>
            <p class="text-xs text-muted-foreground">All backend servers will need to be restarted for the new secret to take effect.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'regen', label: 'Regenerate', class: 'btn-danger', onClick: async () => {
                try {
                    await api.post(`/networks/${network.id}/secret`);
                    showToast('Secret regenerated. Restart all servers.', 'success');
                    network = await api.get(`/networks/${network.id}`);
                    secretVisible = false;
                    renderConfig(el);
                } catch (err) { showToast(err.message, 'error'); }
            }}
        ]);
    });
}

// ==================== DNS TAB ====================

async function renderDns(el, container, params) {
    const dns = network.dns;

    if (!dns || !dns.providerId) {
        // Unconfigured state
        el.innerHTML = `
            <div class="empty-state-dashed p-12 text-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-3">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <h3 class="mb-1 text-sm font-medium text-foreground">No DNS Configured</h3>
                <p class="mb-4 text-xs text-muted-foreground">Connect a DNS provider to automatically manage domain records for this network.</p>
                <button class="btn btn-primary" id="configureDnsBtn">Configure DNS</button>
            </div>
        `;
        el.querySelector('#configureDnsBtn').addEventListener('click', () => showConfigureDnsModal(container, params));
        return;
    }

    // Configured state
    const forcedHosts = dns.forcedHosts || {};
    const records = dns.records || [];
    const backends = network.backends || [];

    el.innerHTML = `
        <div class="flex flex-col gap-4">
            <!-- Domain Settings -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">Domain Settings</h2>
                        <p class="settings-card-desc">DNS records managed automatically via your provider</p>
                    </div>
                    <div class="flex gap-2">
                        <button class="btn btn-secondary btn-sm" id="syncDnsBtn">Sync Records</button>
                        <button class="btn btn-danger btn-sm" id="removeDnsBtn">Remove DNS</button>
                    </div>
                </div>
                <div class="settings-card-body">
                    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Domain</div>
                            <div class="font-mono text-sm">${escapeHtml(dns.baseDomain)}</div>
                        </div>
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Server IP</div>
                            <div class="font-mono text-sm">${escapeHtml(dns.serverIp)}</div>
                        </div>
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Provider</div>
                            <div class="text-sm">${escapeHtml(dns.providerName || dns.providerId)}${dns.providerType ? ` <span class="text-[10px] text-muted-foreground">(${escapeHtml(dns.providerType)})</span>` : ''}</div>
                        </div>
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Auto-Sync</div>
                            <div class="text-sm">${dns.autoSync ? 'Enabled' : 'Disabled'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Forced Hosts -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">Forced Hosts</h2>
                        <p class="settings-card-desc">Map subdomains directly to backend servers (e.g., lobby.play.example.com)</p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="addForcedHostBtn">Add Subdomain</button>
                </div>
                ${Object.keys(forcedHosts).length === 0 ? `
                    <div class="settings-card-body text-xs text-muted-foreground">No forced hosts configured.</div>
                ` : `
                    <div>
                        ${Object.entries(forcedHosts).map(([sId, fh]) => {
                            const backend = backends.find(b => b.id === sId);
                            return `
                                <div class="list-item px-5 py-3">
                                    <div>
                                        <div class="font-mono text-sm font-medium">${escapeHtml(fh.fqdn || fh.subdomain + '.' + dns.baseDomain)}</div>
                                        <div class="text-[11px] text-muted-foreground">${escapeHtml(backend?.alias || backend?.name || sId)}</div>
                                    </div>
                                    <button class="btn btn-sm btn-danger" data-remove-fh="${sId}">Remove</button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>

            <!-- Managed Records -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Managed Records</h2>
                    <p class="settings-card-desc">DNS records created and managed by FortunaPanel</p>
                </div>
                ${records.length === 0 ? `
                    <div class="settings-card-body text-xs text-muted-foreground">No managed records.</div>
                ` : `
                    <div>
                        ${records.map(r => `
                            <div class="list-item px-5 py-2.5">
                                <div class="flex items-center gap-2.5">
                                    <span class="rounded-full border border-border px-2 py-0.5 font-mono text-[10px]">${escapeHtml(r.type)}</span>
                                    <span class="font-mono text-xs">${escapeHtml(r.name)}</span>
                                </div>
                                <span class="font-mono text-[11px] text-muted-foreground">${escapeHtml(r.value)}</span>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        </div>
    `;

    // Wire sync
    el.querySelector('#syncDnsBtn').addEventListener('click', async () => {
        const btn = el.querySelector('#syncDnsBtn');
        btn.disabled = true;
        btn.textContent = 'Syncing...';
        try {
            await api.post(`/dns/networks/${network.id}/sync`);
            showToast('DNS records synced', 'success');
            network = await api.get(`/networks/${network.id}`);
            renderDns(el, container, params);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Sync Records';
        }
    });

    // Wire remove DNS
    el.querySelector('#removeDnsBtn').addEventListener('click', () => {
        showModal('Remove DNS Configuration', `
            <p class="mb-2">Remove DNS configuration from <strong>${escapeHtml(network.name)}</strong>?</p>
            <p class="text-xs text-muted-foreground">All managed DNS records will be deleted from your provider.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'remove', label: 'Remove DNS', class: 'btn-danger', onClick: async () => {
                try {
                    await api.del(`/dns/networks/${network.id}`);
                    showToast('DNS configuration removed', 'success');
                    network = await api.get(`/networks/${network.id}`);
                    renderDns(el, container, params);
                } catch (err) { showToast(err.message, 'error'); }
            }}
        ]);
    });

    // Wire add forced host
    el.querySelector('#addForcedHostBtn').addEventListener('click', () => {
        const availableBackends = backends.filter(b => !forcedHosts[b.id]);
        if (availableBackends.length === 0) {
            showToast('All backends already have forced hosts assigned', 'info');
            return;
        }
        showModal('Add Forced Host', `
            <div class="form-group">
                <label class="form-label">Backend Server</label>
                <select class="form-select" id="fhServer">
                    ${availableBackends.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.alias || b.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Subdomain</label>
                <input type="text" class="form-input" id="fhSubdomain" placeholder="e.g. lobby">
                <div class="form-hint">Will create: <strong><span id="fhPreview">subdomain</span>.${escapeHtml(dns.baseDomain)}</strong></div>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'add', label: 'Add Forced Host', class: 'btn-primary', onClick: async () => {
                const serverId = document.querySelector('#fhServer').value;
                const subdomain = document.querySelector('#fhSubdomain').value;
                try {
                    await api.post(`/dns/networks/${network.id}/forced-hosts`, { serverId, subdomain });
                    showToast('Forced host added', 'success');
                    network = await api.get(`/networks/${network.id}`);
                    renderDns(el, container, params);
                } catch (err) { showToast(err.message, 'error'); }
            }}
        ]);
        // Live preview
        document.querySelector('#fhSubdomain')?.addEventListener('input', (e) => {
            const preview = document.querySelector('#fhPreview');
            if (preview) preview.textContent = e.target.value || 'subdomain';
        });
    });

    // Wire remove forced host
    el.querySelectorAll('[data-remove-fh]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.del(`/dns/networks/${network.id}/forced-hosts/${btn.dataset.removeFh}`);
                showToast('Forced host removed', 'success');
                network = await api.get(`/networks/${network.id}`);
                renderDns(el, container, params);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
}

async function showConfigureDnsModal(container, params) {
    let providers = [];
    try {
        providers = await api.get('/dns/providers');
    } catch (e) {}

    if (!providers.length) {
        showToast('No DNS providers configured. Add one in Settings first.', 'info');
        return;
    }

    showModal('Configure DNS', `
        <div class="form-group">
            <label class="form-label">DNS Provider</label>
            <select class="form-select" id="dnsProvider">
                ${providers.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.type)})</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Base Domain</label>
            <input type="text" class="form-input" id="dnsBaseDomain" placeholder="e.g. play.example.com">
            <div class="form-hint">The domain players connect to. A and SRV records will be created.</div>
        </div>
        <div class="form-group">
            <label class="form-label">Server IP</label>
            <input type="text" class="form-input" id="dnsServerIp" placeholder="e.g. 123.45.67.89">
            <div class="form-hint">Public IP address of this machine.</div>
        </div>
        <div class="form-group mb-0">
            <label class="form-label flex cursor-pointer items-center gap-2">
                <input type="checkbox" id="dnsAutoSync" checked class="accent-white">
                Auto-sync DNS records when backends change
            </label>
        </div>
    `, [
        { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
        { id: 'configure', label: 'Configure DNS', class: 'btn-primary', onClick: async () => {
            const data = {
                providerId: document.querySelector('#dnsProvider').value,
                baseDomain: document.querySelector('#dnsBaseDomain').value,
                serverIp: document.querySelector('#dnsServerIp').value,
                autoSync: document.querySelector('#dnsAutoSync').checked
            };
            try {
                await api.post(`/dns/networks/${network.id}`, data);
                showToast('DNS configured', 'success');
                network = await api.get(`/networks/${network.id}`);
                currentTab = 'dns';
                renderPage(container, params);
            } catch (err) { showToast(err.message, 'error'); }
        }}
    ]);
}

// ==================== HEALTH TAB ====================

async function renderHealth(el, container, params) {
    const backends = network.backends || [];
    const healthCheck = network.healthCheck || {};

    // Fetch health data
    let healthData = {};
    try {
        healthData = await api.get(`/health/network/${network.id}`);
    } catch (e) {}

    el.innerHTML = `
        <div class="flex flex-col gap-4">
            <!-- Health Configuration -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Health Monitoring</h2>
                    <p class="settings-card-desc">Configure automatic TCP health checks for backend servers</p>
                </div>
                <div class="settings-card-body">
                    <div class="flex max-w-[400px] flex-col gap-3">
                        <label class="form-label mb-0 flex cursor-pointer items-center gap-2">
                            <input type="checkbox" id="healthEnabled" ${healthCheck.enabled ? 'checked' : ''} class="accent-white">
                            Enable health monitoring
                        </label>
                        <div class="form-group mb-0">
                            <label class="form-label">Check Interval</label>
                            <select class="form-select" id="healthInterval">
                                <option value="15" ${healthCheck.intervalSeconds === 15 ? 'selected' : ''}>Every 15 seconds</option>
                                <option value="30" ${!healthCheck.intervalSeconds || healthCheck.intervalSeconds === 30 ? 'selected' : ''}>Every 30 seconds</option>
                                <option value="60" ${healthCheck.intervalSeconds === 60 ? 'selected' : ''}>Every 60 seconds</option>
                                <option value="120" ${healthCheck.intervalSeconds === 120 ? 'selected' : ''}>Every 2 minutes</option>
                            </select>
                        </div>
                        <div class="form-group mb-0">
                            <label class="form-label">Failure Threshold</label>
                            <select class="form-select" id="healthThreshold">
                                <option value="2" ${healthCheck.failureThreshold === 2 ? 'selected' : ''}>2 failures</option>
                                <option value="3" ${!healthCheck.failureThreshold || healthCheck.failureThreshold === 3 ? 'selected' : ''}>3 failures</option>
                                <option value="5" ${healthCheck.failureThreshold === 5 ? 'selected' : ''}>5 failures</option>
                                <option value="10" ${healthCheck.failureThreshold === 10 ? 'selected' : ''}>10 failures</option>
                            </select>
                        </div>
                        <label class="form-label mb-0 flex cursor-pointer items-center gap-2">
                            <input type="checkbox" id="healthAutoRestart" ${healthCheck.autoRestart ? 'checked' : ''} class="accent-white">
                            Auto-restart unhealthy servers
                        </label>
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="saveHealthBtn">Save Health Config</button>
                </div>
            </div>

            <!-- Server Health Status -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Server Health Status</h2>
                    <p class="settings-card-desc">Real-time health status of all backend servers</p>
                </div>
                ${backends.length === 0 ? `
                    <div class="settings-card-body text-xs text-muted-foreground">No backend servers to monitor.</div>
                ` : `
                    <div>
                        ${backends.map(b => {
                            const h = healthData[b.id] || b.health || { status: 'unknown' };
                            const dotColor = h.status === 'healthy' ? '#22c55e' : h.status === 'unhealthy' ? '#ef4444' : '#71717a';
                            const lastCheck = h.lastCheck ? new Date(h.lastCheck).toLocaleTimeString() : 'Never';
                            return `
                                <div class="list-item px-5 py-3.5">
                                    <div class="flex items-center gap-3">
                                        <div class="h-2.5 w-2.5 flex-shrink-0 rounded-full" style="background:${dotColor}"></div>
                                        <div>
                                            <div class="text-sm font-medium">${escapeHtml(b.alias || b.name || 'unknown')}</div>
                                            <div class="text-[11px] text-muted-foreground">
                                                ${escapeHtml(h.status)} &middot; Last check: ${escapeHtml(lastCheck)}
                                                ${h.consecutiveFailures > 0 ? ` &middot; ${h.consecutiveFailures} failure${h.consecutiveFailures !== 1 ? 's' : ''}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    ${h.status === 'unhealthy' ? `<button class="btn btn-sm btn-secondary" data-health-restart="${b.id}">Restart</button>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
        </div>
    `;

    // Wire save health config
    el.querySelector('#saveHealthBtn').addEventListener('click', async () => {
        const btn = el.querySelector('#saveHealthBtn');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            await api.patch(`/networks/${network.id}`, {
                healthCheck: {
                    enabled: el.querySelector('#healthEnabled').checked,
                    intervalSeconds: parseInt(el.querySelector('#healthInterval').value),
                    failureThreshold: parseInt(el.querySelector('#healthThreshold').value),
                    autoRestart: el.querySelector('#healthAutoRestart').checked
                }
            });
            showToast('Health config saved', 'success');
            network = await api.get(`/networks/${network.id}`);
            renderHealth(el, container, params);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Save Health Config';
        }
    });

    // Wire restart unhealthy
    el.querySelectorAll('[data-health-restart]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const serverId = btn.dataset.healthRestart;
            btn.disabled = true;
            btn.textContent = 'Restarting...';
            try {
                await api.post(`/servers/${serverId}/restart`);
                showToast('Server restarting', 'success');
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
}

// ==================== SETTINGS TAB ====================

function renderSettings(el, container, params) {
    const forwardingOptions = network.proxyType === 'velocity'
        ? ['modern', 'legacy', 'bunguard', 'none']
        : ['ip_forward'];

    const backends = network.backends || [];
    const proxyRunning = network.proxy?.status === 'running';
    const bootOrder = network.bootOrder || [];

    el.innerHTML = `
        <div class="flex max-w-[600px] flex-col gap-4">
            <!-- General Settings -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">General</h2>
                </div>
                <div class="settings-card-body">
                    <div class="form-group">
                        <label class="form-label">Network Name</label>
                        <input type="text" class="form-input" id="networkName" value="${escapeHtml(network.name)}">
                    </div>
                    <div class="form-group mb-0">
                        <label class="form-label">Forwarding Mode</label>
                        <select class="form-select" id="forwardingMode">
                            ${forwardingOptions.map(m => `<option value="${m}" ${m === network.forwardingMode ? 'selected' : ''}>${m}</option>`).join('')}
                        </select>
                        <div class="form-hint">${network.proxyType === 'velocity' ? 'Modern forwarding is recommended for Velocity.' : 'BungeeCord uses IP forwarding.'}</div>
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="saveSettingsBtn">Save Settings</button>
                </div>
            </div>

            <!-- Boot Order -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">Boot Order</h2>
                        <p class="settings-card-desc">Define startup sequence when starting the network. Servers in the same stage start in parallel; stages run sequentially.</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="addStageBtn">Add Stage</button>
                </div>
                <div class="settings-card-body" id="bootOrderContainer">
                    ${bootOrder.length === 0 ? `
                        <div class="text-xs text-muted-foreground">No boot order configured. All backends will start simultaneously.</div>
                    ` : bootOrder.map((stage, i) => `
                        <div class="rounded-md border border-border bg-muted p-3 ${i < bootOrder.length - 1 ? 'mb-3' : ''}">
                            <div class="mb-2 flex items-center justify-between">
                                <span class="text-xs font-semibold">Stage ${i + 1}</span>
                                <button class="btn btn-sm btn-danger" data-remove-stage="${i}">Remove</button>
                            </div>
                            <div class="flex flex-wrap gap-1.5">
                                ${backends.map(b => {
                                    const inStage = stage.includes(b.id);
                                    return `<label class="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs" style="background:${inStage ? 'var(--bg-card)' : 'transparent'}">
                                        <input type="checkbox" class="boot-order-cb accent-white" data-stage="${i}" data-server="${escapeHtml(b.id)}" ${inStage ? 'checked' : ''}>
                                        ${escapeHtml(b.alias || b.name)}
                                    </label>`;
                                }).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="settings-card-footer settings-card-footer-split">
                    <button class="btn btn-secondary btn-sm" id="resetBootOrderBtn">Reset</button>
                    <button class="btn btn-primary btn-sm" id="saveBootOrderBtn">Save Boot Order</button>
                </div>
            </div>

            <!-- Rolling Restart -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">Rolling Restart</h2>
                        <p class="settings-card-desc">Restart backends one at a time to minimize downtime</p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="rollingRestartBtn">Start Rolling Restart</button>
                </div>
            </div>

            <!-- Danger Zone -->
            <div class="settings-card">
                <div class="settings-card-body">
                    <div class="danger-zone m-0">
                        <h3 class="danger-zone-title">Danger Zone</h3>
                        <p class="danger-zone-desc">Deleting a network removes the grouping only. All servers will remain in the panel and backend configs will be reset.</p>
                        <button class="btn btn-danger" id="deleteNetworkBtn">Delete Network</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Wire save general settings
    el.querySelector('#saveSettingsBtn').addEventListener('click', async () => {
        const name = el.querySelector('#networkName').value;
        const forwardingMode = el.querySelector('#forwardingMode').value;
        try {
            await api.patch(`/networks/${network.id}`, { name, forwardingMode });
            showToast('Settings saved', 'success');
            network = await api.get(`/networks/${network.id}`);
            renderPage(container, params);
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Wire boot order
    el.querySelector('#addStageBtn').addEventListener('click', () => {
        const current = getBootOrderFromUI(el, backends);
        current.push([]);
        network.bootOrder = current;
        renderSettings(el, container, params);
    });

    el.querySelectorAll('[data-remove-stage]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.removeStage);
            const current = getBootOrderFromUI(el, backends);
            current.splice(idx, 1);
            network.bootOrder = current;
            renderSettings(el, container, params);
        });
    });

    el.querySelector('#resetBootOrderBtn').addEventListener('click', () => {
        network.bootOrder = [];
        renderSettings(el, container, params);
    });

    el.querySelector('#saveBootOrderBtn').addEventListener('click', async () => {
        const order = getBootOrderFromUI(el, backends);
        try {
            await api.patch(`/networks/${network.id}`, { bootOrder: order });
            showToast('Boot order saved', 'success');
            network = await api.get(`/networks/${network.id}`);
            renderSettings(el, container, params);
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Wire rolling restart
    el.querySelector('#rollingRestartBtn').addEventListener('click', () => {
        showModal('Rolling Restart', `
            <p class="mb-2">Start a rolling restart for <strong>${escapeHtml(network.name)}</strong>?</p>
            <p class="text-xs text-muted-foreground">Each backend server will be restarted one at a time, waiting for each to come back online before proceeding.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'start', label: 'Start Rolling Restart', class: 'btn-primary', onClick: async () => {
                try {
                    await api.post(`/networks/${network.id}/rolling-restart`);
                    showToast('Rolling restart started', 'success');
                } catch (err) { showToast(err.message, 'error'); }
            }}
        ]);
    });

    // Wire delete network
    el.querySelector('#deleteNetworkBtn').addEventListener('click', () => {
        const backendList = backends.length > 0
            ? `<div class="mt-2.5 rounded-lg border border-border bg-muted p-2.5 text-xs">
                        <div class="mb-1 font-medium">${backends.length} backend${backends.length !== 1 ? 's' : ''} will be de-configured:</div>
                        ${backends.map(b => `<div class="text-muted-foreground">&middot; ${escapeHtml(b.alias || b.name || 'unknown')} (${escapeHtml(b.name)})</div>`).join('')}
               </div>`
            : '';

        const runningWarning = proxyRunning
            ? `<div class="mb-2.5 flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5 text-xs text-foreground">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                This network is currently running. Consider stopping it first.
               </div>`
            : '';

        showModal('Delete Network', `
            ${runningWarning}
            <p class="mb-2">Delete <strong>${escapeHtml(network.name)}</strong>?</p>
            <p class="text-xs text-muted-foreground">This removes the network grouping. All servers will remain in the panel and backend proxy configurations will be reset to defaults.</p>
            ${backendList}
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'delete', label: 'Delete Network', class: 'btn-danger', onClick: async () => {
                try {
                    await api.del(`/networks/${network.id}`);
                    showToast('Network deleted', 'success');
                    app.navigate('/networks');
                } catch (err) { showToast(err.message, 'error'); }
            }}
        ]);
    });
}

function getBootOrderFromUI(el, backends) {
    const stages = [];
    const stageEls = el.querySelectorAll('[data-remove-stage]');
    for (let i = 0; i < stageEls.length; i++) {
        const serverIds = [];
        el.querySelectorAll(`.boot-order-cb[data-stage="${i}"]:checked`).forEach(cb => {
            serverIds.push(cb.dataset.server);
        });
        stages.push(serverIds);
    }
    return stages;
}

// escapeHtml imported from app.js

export function destroy() {
    if (networkListener) {
        ws.off('network-status', networkListener);
        networkListener = null;
    }
    if (backendListener) {
        ws.off('network-backend-changed', backendListener);
        backendListener = null;
    }
    if (statusListener) {
        ws.off('server-status', statusListener);
        statusListener = null;
    }
    if (healthListener) {
        ws.off('health-changed', healthListener);
        healthListener = null;
    }
    if (maintenanceListener) {
        ws.off('maintenance-changed', maintenanceListener);
        maintenanceListener = null;
    }
    if (rollingRestartListener) {
        ws.off('rolling-restart-started', rollingRestartListener);
        ws.off('rolling-restart-progress', rollingRestartListener);
        ws.off('rolling-restart-completed', rollingRestartListener);
        rollingRestartListener = null;
    }
    network = null;
    currentTab = 'overview';
    secretVisible = false;
}



