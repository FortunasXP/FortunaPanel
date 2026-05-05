// FortunaPanel - Server Detail Page
import { api } from '../api.js';
import { ws } from '../websocket.js';
import { app, showToast, showModal, escapeHtml } from '../app.js';
import { ConsoleComponent } from '../components/console.js';
import { drawChart } from '../components/chart.js';
import { parseYaml, stringifyYaml } from '../components/yaml-parser.js';
import { parseToml, stringifyToml } from '../components/toml-parser.js';
import { getConfigDefinition, getCategories } from '../config-definitions.js';

let server = null;
let networkInfo = null;
let consoleComp = null;
let activeTab = 'console';
let statusListener = null;
let resourceListener = null;
let resourceAlertListener = null;
let crashListener = null;
let maxCrashesListener = null;
let crashCountdownInterval = null;

export function breadcrumbs(params) {
    return [
        { label: 'Dashboard', href: '/' },
        { label: server?.name || 'Server', href: `/server/${params.id}` }
    ];
}

export async function render(container, params) {
    try {
        server = await api.get(`/servers/${params.id}`);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><h3>Server not found</h3><p>${escapeHtml(e.message)}</p></div>`;
        return;
    }

    // Fetch network membership info
    networkInfo = null;
    try {
        const networks = await api.get('/networks');
        for (const net of networks) {
            if (net.proxyId === params.id) {
                networkInfo = { id: net.id, name: net.name, role: 'proxy' };
                break;
            }
            if ((net.backendIds || []).includes(params.id)) {
                networkInfo = { id: net.id, name: net.name, role: 'backend', alias: net.backendAliases?.[params.id] };
                break;
            }
        }
    } catch (e) { /* networks API may not be ready */ }

    renderPage(container, params);

    // Listen for status updates
    statusListener = (data) => {
        if (data.serverId === params.id) {
            server.status = data.status;
            updateStatusUI(container);
        }
    };
    ws.on('server-status', statusListener);

    // Listen for real-time resource usage (compact inline display)
    resourceListener = (data) => {
        if (data.serverId === params.id) {
            updateResourceInline(container, data);
        }
    };
    ws.on('resource-usage', resourceListener);

    // Prime resource display with last-known usage so we don't show dashes
    // until the next 10s poll. Safe to ignore errors; the listener will
    // catch up shortly.
    if (server.status === 'running') {
        api.get(`/resources/${params.id}`).then(r => {
            if (r && r.usage) {
                updateResourceInline(container, {
                    serverId: params.id,
                    cpu: r.usage.cpu || 0,
                    memory: r.usage.memory || 0,
                    disk: r.usage.disk || 0
                });
            }
        }).catch(() => {});
    }

    // Listen for resource limit alerts
    resourceAlertListener = (data) => {
        if (data.serverId === params.id) {
            showToast(`${data.resource.toUpperCase()} limit exceeded: ${data.current.toFixed(1)} > ${data.limit}`, 'error');
        }
    };
    ws.on('resource-alert', resourceAlertListener);

    // Listen for crash events
    crashListener = (data) => {
        if (data.serverId === params.id) {
            server.crashCount = data.crashCount;
            server.lastCrashTime = Date.now();
            updateCrashBanner(container);
            if (data.willRestart && data.nextRestartIn) {
                showToast(`Server crashed (exit code ${data.exitCode}). Restarting in ${Math.round(data.nextRestartIn / 1000)}s... (attempt ${data.crashCount})`, 'error');
                // Show countdown in crash banner
                let remaining = Math.round(data.nextRestartIn / 1000);
                const bannerText = container.querySelector('#crashBannerText');
                if (crashCountdownInterval) clearInterval(crashCountdownInterval);
                crashCountdownInterval = setInterval(() => {
                    remaining--;
                    if (remaining <= 0 || server.status === 'starting' || server.status === 'running') {
                        clearInterval(crashCountdownInterval);
                        crashCountdownInterval = null;
                        updateCrashBanner(container);
                    } else if (bannerText) {
                        bannerText.textContent = `Crash count: ${server.crashCount}. Restarting in ${remaining}s...`;
                    }
                }, 1000);
            } else {
                showToast(`Server crashed (exit code ${data.exitCode}). Crash #${data.crashCount}`, 'error');
            }
        }
    };
    ws.on('server-crash', crashListener);

    maxCrashesListener = (data) => {
        if (data.serverId === params.id) {
            showToast(`Server exceeded max auto-restarts (${data.maxAutoRestarts}). Manual restart required.`, 'error');
        }
    };
    ws.on('server-max-crashes', maxCrashesListener);
}

function isProxyServer() {
    return ['velocity', 'bungeecord'].includes(server?.type);
}

function renderPage(container, params) {
    const statusClass = server.status === 'running' ? 'online' :
                        server.status === 'stopped' ? 'offline' : 'starting';
    const statusLabel = server.status.charAt(0).toUpperCase() + server.status.slice(1);

    container.innerHTML = `
        <div class="page-header items-start">
            <div class="flex items-center gap-3.5">
                <div class="icon-box icon-box-lg border-border bg-card">
                    ${isProxyServer() ? `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
                            <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
                        </svg>
                    ` : `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="2" width="20" height="8" rx="2"/>
                            <rect x="2" y="14" width="20" height="8" rx="2"/>
                            <circle cx="6" cy="6" r="1"/><circle cx="6" cy="18" r="1"/>
                        </svg>
                    `}
                </div>
                <div>
                    <h1 class="text-[22px] font-bold tracking-tight text-foreground">${escapeHtml(server.name)}</h1>
                    <div class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>${escapeHtml(server.type)} ${escapeHtml(server.version)}</span>
                        <span class="text-muted-foreground">&middot;</span>
                        <span>Port ${escapeHtml(server.port)}</span>
                        <span id="resourceInline" class="${server.status === 'running' ? 'flex' : 'hidden'} ml-1 items-center gap-2">
                            <span class="text-muted-foreground">&middot;</span>
                            <span id="cpuVal" class="font-mono">--%</span> CPU
                            <span class="text-muted-foreground">&middot;</span>
                            <span id="memVal" class="font-mono">--</span> MB
                        </span>
                    </div>
                </div>
            </div>
            <div id="serverControls" class="flex items-center gap-2">
                <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                    <span class="status-dot ${statusClass}" id="statusDot"></span>
                    <span id="statusLabel">${server.suspended ? 'Suspended' : statusLabel}</span>
                </span>
                ${renderControlButtons()}
            </div>
        </div>

        ${server.suspended ? `
            <div id="suspendBanner" class="mb-5 flex items-center gap-2.5 rounded-lg border border-border bg-muted px-4 py-3.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>
                    <div class="text-sm font-semibold text-foreground">Server Suspended</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">This server has been suspended${server.suspendedAt ? ' on ' + new Date(server.suspendedAt).toLocaleString() : ''}. It cannot be started until unsuspended.</div>
                </div>
            </div>
        ` : ''}

        <div id="crashBanner" class="${server.crashCount > 0 ? 'flex' : 'hidden'} mb-5 items-center gap-2.5 rounded-lg border border-border bg-muted px-4 py-3.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div>
                <div class="text-sm font-semibold text-foreground">Server Crashed</div>
                <div class="mt-0.5 text-xs text-muted-foreground" id="crashBannerText">${server.crashCount > 0 ? `Crash count: ${server.crashCount}${server.autoRestart ? '. Auto-restart is enabled.' : '. Auto-restart is disabled.'}` : ''}</div>
            </div>
        </div>

        ${networkInfo ? `
            <div class="mb-5 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5">
                <div class="flex items-center gap-2.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
                        <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
                    </svg>
                    <div>
                        <div class="text-sm font-medium text-foreground">Part of network <strong>${networkInfo.name}</strong></div>
                        <div class="mt-0.5 text-xs text-muted-foreground">${networkInfo.role === 'proxy' ? 'Proxy server for this network' : `Backend server${networkInfo.alias ? ` (alias: ${networkInfo.alias})` : ''}`}</div>
                    </div>
                </div>
                <a href="/network/${networkInfo.id}" class="btn btn-secondary btn-sm" id="viewNetworkLink">View Network</a>
            </div>
        ` : ''}

        <div class="tabs">
            <div class="tab ${activeTab === 'console' ? 'active' : ''}" data-tab="console">Console</div>
            ${!isProxyServer() ? `<div class="tab ${activeTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</div>` : ''}
            ${!isProxyServer() ? `<div class="tab ${activeTab === 'players' ? 'active' : ''}" data-tab="players">Players</div>` : ''}
            <div class="tab ${activeTab === 'files' ? 'active' : ''}" data-tab="files">Files</div>
            ${!isProxyServer() ? `<div class="tab ${activeTab === 'plugins' ? 'active' : ''}" data-tab="plugins">Plugins</div>` : ''}
            <div class="tab ${activeTab === 'backups' ? 'active' : ''}" data-tab="backups">Backups</div>
            <div class="tab ${activeTab === 'startup' ? 'active' : ''}" data-tab="startup">Startup</div>
            ${!isProxyServer() ? `<div class="tab ${activeTab === 'properties' ? 'active' : ''}" data-tab="properties">Properties</div>` : ''}
            <div class="tab ${activeTab === 'config' ? 'active' : ''}" data-tab="config">Config</div>
            <div class="tab ${activeTab === 'permissions' ? 'active' : ''}" data-tab="permissions">Permissions</div>
            <div class="tab ${activeTab === 'dns' ? 'active' : ''}" data-tab="dns">DNS</div>
            <div class="tab ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</div>
        </div>

        <div id="consoleWrapper" class="hidden"><div id="consoleContainer"></div></div>
        <div id="tabContent"></div>
    `;

    // Create console component once, it lives for the entire page lifetime
    const consoleContainer = container.querySelector('#consoleContainer');
    consoleComp = new ConsoleComponent(consoleContainer, params.id);
    if (server.consoleHistory) {
        consoleComp.loadHistory(server.consoleHistory);
    }

    wireControls(container, params);
    renderTab(container, params);
}

function renderControlButtons() {
    if (server.suspended) {
        return `<button class="btn btn-success btn-sm" id="unsuspendBtn">Unsuspend</button>
                <button class="btn btn-secondary btn-sm" id="deleteBtn">Delete</button>`;
    }
    if (server.status === 'running') {
        return `<button class="btn btn-danger btn-sm" id="stopBtn">Stop</button>
                <button class="btn btn-secondary btn-sm" id="restartBtn">Restart</button>
                <button class="btn btn-secondary btn-sm" id="deleteBtn">Delete</button>`;
    }
    if (server.status === 'starting' || server.status === 'stopping') {
        return `<button class="btn btn-secondary btn-sm" disabled>${server.status === 'starting' ? 'Starting...' : 'Stopping...'}</button>
                <button class="btn btn-secondary btn-sm" id="deleteBtn">Delete</button>`;
    }
    return `<button class="btn btn-success btn-sm" id="startBtn">Start</button>
            <button class="btn btn-secondary btn-sm" id="deleteBtn">Delete</button>`;
}

function updateResourceInline(container, data) {
    const inline = container.querySelector('#resourceInline');
    if (!inline) return;
    inline.classList.remove('hidden');
    inline.classList.add('flex');

    const cpuVal = container.querySelector('#cpuVal');
    const memVal = container.querySelector('#memVal');

    if (cpuVal) cpuVal.textContent = `${data.cpu.toFixed(1)}%`;
    if (memVal) memVal.textContent = `${data.memory.toFixed(0)}`;
}

function updateCrashBanner(container) {
    const banner = container.querySelector('#crashBanner');
    const text = container.querySelector('#crashBannerText');
    if (!banner) return;
    if (server.crashCount > 0) {
        banner.classList.remove('hidden');
        banner.classList.add('flex');
        if (text) text.textContent = `Crash count: ${server.crashCount}${server.autoRestart ? '. Auto-restart is enabled.' : '. Auto-restart is disabled.'}`;
    } else {
        banner.classList.remove('flex');
        banner.classList.add('hidden');
    }
}

function wireControlButtons(container, params) {
    container.querySelector('#startBtn')?.addEventListener('click', async () => {
        try {
            await api.post(`/servers/${params.id}/start`);
            showToast('Server starting...', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    });
    container.querySelector('#stopBtn')?.addEventListener('click', async () => {
        try {
            await api.post(`/servers/${params.id}/stop`);
            showToast('Server stopping...', 'warning');
        } catch (e) { showToast(e.message, 'error'); }
    });
    container.querySelector('#restartBtn')?.addEventListener('click', async () => {
        try {
            await api.post(`/servers/${params.id}/restart`);
            showToast('Server restarting...', 'warning');
        } catch (e) { showToast(e.message, 'error'); }
    });
    container.querySelector('#unsuspendBtn')?.addEventListener('click', async () => {
        try {
            await api.post(`/servers/${params.id}/unsuspend`);
            server.suspended = false;
            showToast('Server unsuspended', 'success');
            renderPage(container, params);
        } catch (e) { showToast(e.message, 'error'); }
    });
    container.querySelector('#deleteBtn')?.addEventListener('click', () => {
        showModal('Delete Server', `
            <p class="mb-3">Are you sure you want to delete <strong class="text-foreground">${server.name}</strong>?</p>
            <p class="text-xs text-muted-foreground">This will permanently delete all server files.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                try {
                    await api.del(`/servers/${params.id}`);
                    showToast('Server deleted', 'success');
                    app.navigate('/');
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });
}

function wireControls(container, params) {
    wireControlButtons(container, params);

    // Wire network link
    container.querySelector('#viewNetworkLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        app.navigate(e.currentTarget.getAttribute('href'));
    });

    // Tabs
    container.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderTab(container, params);
        });
    });
}

function renderTab(container, params) {
    const content = container.querySelector('#tabContent');
    const consoleWrapper = container.querySelector('#consoleWrapper');

    if (activeTab === 'console') {
        // Show persistent console, hide tab content
        consoleWrapper.classList.remove('hidden');
        content.classList.add('hidden');
        content.innerHTML = '';
        if (consoleComp) consoleComp.focus();
    } else {
        // Hide console, show tab content
        consoleWrapper.classList.add('hidden');
        content.classList.remove('hidden');

        switch (activeTab) {
            case 'players':
                renderPlayersTab(content, params);
                break;
            case 'files':
                renderFilesTab(content, params);
                break;
            case 'plugins':
                renderPluginsTab(content, params);
                break;
            case 'backups':
                renderBackupsTab(content, params);
                break;
            case 'startup':
                renderStartupTab(content, params);
                break;
            case 'properties':
                renderPropertiesTab(content, params);
                break;
            case 'config':
                renderConfigTab(content, params);
                break;
            case 'permissions':
                renderPermissionsTab(content, params);
                break;
            case 'dns':
                renderDnsTab(content, params);
                break;
            case 'settings':
                renderSettingsTab(content, params);
                break;
            case 'stats':
                renderStatsTab(content, params);
                break;
        }
    }
}

async function renderConfigTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    let configFiles = [];
    let loadError = null;
    try {
        configFiles = await api.get(`/servers/${params.id}/config-files`);
    } catch (e) {
        loadError = e.message || 'Failed to load config files';
    }

    if (loadError) {
        content.innerHTML = `
            <div class="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
                <h3 class="text-base font-semibold text-destructive">Failed to load config files</h3>
                <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">${escapeHtml(loadError)}</p>
            </div>`;
        return;
    }

    // All file types are editable — yaml/toml get structured editors, others fall back to raw.
    const editableFiles = configFiles;

    if (editableFiles.length === 0) {
        content.innerHTML = `
            <div class="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <h3 class="mt-4 text-base font-semibold">No config files found</h3>
                <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Start the server at least once to generate config files, then return here to edit them.</p>
            </div>`;
        return;
    }

    let activeFile = editableFiles.length > 0 ? editableFiles.find(f => f.recommended)?.file || editableFiles[0].file : null;

    async function loadConfigFile(file) {
        activeFile = file;
        const fileInfo = editableFiles.find(f => f.file === file);
        if (!fileInfo) return;

        // Show loading in editor area only
        const editorArea = content.querySelector('#configEditor');
        if (editorArea) editorArea.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

        let rawText = '';
        try {
            const result = await api.get(`/servers/${params.id}/files/read?path=${encodeURIComponent(file)}`);
            rawText = result.content || '';
        } catch (e) {
            if (editorArea) editorArea.innerHTML = `<div class="empty-state p-5"><p>Failed to load: ${escapeHtml(e.message)}</p></div>`;
            return;
        }

        const definition = getConfigDefinition(file);
        let parsed = {};
        try {
            if (fileInfo.type === 'yaml') parsed = parseYaml(rawText);
            else if (fileInfo.type === 'toml') parsed = parseToml(rawText);
        } catch {
            parsed = {};
        }

        // Flatten the parsed object for lookups
        const flat = flattenObj(parsed);

        if (definition) {
            renderStructuredEditor(editorArea, file, fileInfo.type, definition, flat, rawText, params);
        } else {
            renderRawEditor(editorArea, file, rawText, params);
        }

        // Update active file buttons
        content.querySelectorAll('[data-config-file]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.configFile === file);
        });
    }

    const activeMeta = editableFiles.find(f => f.file === activeFile);

    // Render file selector + editor area
    content.innerHTML = `
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
            <aside class="rounded-lg border border-border bg-card p-3">
                <div class="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Config Files</div>
                <div class="flex flex-col gap-1">
                    ${editableFiles.map(f => `
                        <button class="config-file-btn ${f.file === activeFile ? 'active' : ''} w-full rounded-lg border border-border bg-muted px-3 py-2 text-left transition" data-config-file="${f.file}">
                            <div class="truncate text-sm font-medium text-foreground">${f.label}</div>
                            <div class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">${f.file}</div>
                        </button>
                    `).join('')}
                </div>
            </aside>

            <section class="min-w-0 rounded-lg border border-border bg-card p-4">
                <div class="mb-3 flex items-center justify-between">
                    <div>
                        <div class="text-sm font-semibold text-foreground" id="configHeaderLabel">${activeMeta?.label || 'Configuration'}</div>
                        <div class="font-mono text-[11px] text-muted-foreground" id="configHeaderPath">${activeMeta?.file || ''}</div>
                    </div>
                    <span class="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground" id="configHeaderType">${activeMeta?.type?.toUpperCase() || 'CFG'}</span>
                </div>
                <div id="configEditor" class="min-w-0">
                <div class="page-loading"><div class="spinner"></div></div>
                </div>
            </section>
        </div>
    `;

    // Update the summary header block when file changes
    function updateConfigHeader(file) {
        const meta = editableFiles.find(f => f.file === file);
        const title = content.querySelector('#configHeaderLabel');
        const path = content.querySelector('#configHeaderPath');
        const type = content.querySelector('#configHeaderType');
        if (title && meta) title.textContent = meta.label;
        if (path && meta) path.textContent = meta.file;
        if (type && meta) type.textContent = (meta.type || 'cfg').toUpperCase();
    }

    // Wire file buttons
    content.querySelectorAll('[data-config-file]').forEach(btn => {
        btn.addEventListener('click', () => {
            updateConfigHeader(btn.dataset.configFile);
            loadConfigFile(btn.dataset.configFile);
        });
    });

    // Load first file
    if (activeFile) loadConfigFile(activeFile);
}

function renderStructuredEditor(container, file, fileType, definition, flatValues, rawText, params) {
    const categories = getCategories(definition);
    let activeCategory = categories.keys().next().value;
    let filterText = '';

    function renderCategory(cat) {
        activeCategory = cat;
        const props = categories.get(cat) || [];
        const normalizedFilter = filterText.trim().toLowerCase();
        const visibleProps = normalizedFilter
            ? props.filter((p) => (p.key + ' ' + (p.description || '')).toLowerCase().includes(normalizedFilter))
            : props;

        const modifiedCount = Object.keys(definition.properties || {}).filter((k) => flatValues.hasOwnProperty(k) && flatValues[k] !== definition.properties[k]?.default).length;
        const catTabs = Array.from(categories.keys());

        container.innerHTML = `
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-foreground">${definition.label}</span>
                    <span class="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">${modifiedCount} modified</span>
                </div>
                <div class="flex gap-1.5">
                    <button class="btn btn-sm btn-secondary" id="rawEditorBtn">Raw Editor</button>
                    <button class="btn btn-sm btn-primary" id="saveConfigBtn">Save</button>
                </div>
            </div>
            <div class="mb-3 flex flex-wrap gap-1">
                ${catTabs.map(c => `
                    <button class="btn btn-sm ${c === cat ? 'btn-primary' : 'btn-secondary'}" data-cat="${c}">${c}</button>
                `).join('')}
            </div>
            <div class="mb-3">
                <input type="text" class="form-input text-sm" id="configFilter" placeholder="Filter keys in ${cat}..." value="${escapeHtml(filterText)}">
            </div>
            <div class="settings-card">
                <div class="settings-card-body px-5 py-4">
                    ${visibleProps.length > 0 ? visibleProps.map(p => renderConfigProperty(p, flatValues)).join('') : '<div class="text-sm text-muted-foreground">No matching keys in this category.</div>'}
                </div>
            </div>
        `;

        // Wire category tabs
        container.querySelectorAll('[data-cat]').forEach(btn => {
            btn.addEventListener('click', () => renderCategory(btn.dataset.cat));
        });

        container.querySelector('#configFilter')?.addEventListener('input', (e) => {
            filterText = e.target.value || '';
            renderCategory(activeCategory);
        });

        // Wire raw editor button
        container.querySelector('#rawEditorBtn')?.addEventListener('click', () => {
            renderRawEditor(container, file, rawText, params);
        });

        // Wire save button
        container.querySelector('#saveConfigBtn')?.addEventListener('click', async () => {
            // Gather all values from current category and previously loaded
            const allInputs = container.querySelectorAll('[data-config-key]');
            allInputs.forEach(input => {
                const key = input.dataset.configKey;
                const defProp = definition.properties[key];
                if (!defProp) return;

                if (defProp.type === 'boolean') {
                    flatValues[key] = input.checked;
                } else if (defProp.type === 'number') {
                    flatValues[key] = parseFloat(input.value) || 0;
                } else {
                    flatValues[key] = input.value;
                }
            });

            // Rebuild nested object from flat values
            const newObj = unflattenObj(flatValues);

            // Merge back into parsed structure and stringify preserving comments
            let newText;
            if (fileType === 'yaml') {
                newText = stringifyYaml(newObj, rawText);
            } else {
                newText = stringifyToml(newObj, rawText);
            }

            try {
                await api.put(`/servers/${params.id}/files/write?path=${encodeURIComponent(file)}`, { content: newText });
                rawText = newText;
                showToast('Config saved. Restart the server to apply changes.', 'success');
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    }

    renderCategory(activeCategory);
}

function renderConfigProperty(prop, flatValues) {
    const key = prop.key;
    const value = flatValues.hasOwnProperty(key) ? flatValues[key] : prop.default;
    const isModified = flatValues.hasOwnProperty(key) && flatValues[key] !== prop.default;

    const modifiedDot = isModified ? '<span class="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" title="Modified from default"></span>' : '';

    if (prop.type === 'boolean') {
        return `
            <div class="form-group mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <label class="form-label mb-0 flex cursor-pointer items-center gap-2 text-foreground">
                    <input type="checkbox" data-config-key="${key}" ${value ? 'checked' : ''} class="accent-white">
                    <span>${prop.description}${modifiedDot}</span>
                </label>
                <div class="form-hint ml-6">${key}</div>
            </div>`;
    }

    if (prop.type === 'select') {
        return `
            <div class="form-group mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <label class="form-label text-xs">${prop.description}${modifiedDot}</label>
                <select class="form-select max-w-[260px]" data-config-key="${key}">
                    ${(prop.options || []).map(o => `<option value="${o}" ${String(value) === String(o) ? 'selected' : ''}>${o}</option>`).join('')}
                </select>
                <div class="form-hint">${key}</div>
            </div>`;
    }

    if (prop.type === 'number') {
        return `
            <div class="form-group mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <label class="form-label text-xs">${prop.description}${modifiedDot}</label>
                <input type="number" class="form-input max-w-[180px]" data-config-key="${key}" value="${value ?? ''}"
                       ${prop.min !== undefined ? `min="${prop.min}"` : ''} ${prop.max !== undefined ? `max="${prop.max}"` : ''}
                       >
                <div class="form-hint">${key}${prop.default !== undefined ? ` (default: ${prop.default})` : ''}</div>
            </div>`;
    }

    // String
    return `
        <div class="form-group mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <label class="form-label text-xs">${prop.description}${modifiedDot}</label>
            <input type="text" class="form-input" data-config-key="${key}" value="${escapeHtml(String(value ?? ''))}">
            <div class="form-hint">${key}</div>
        </div>`;
}

function renderRawEditor(container, file, rawText, params) {
    container.innerHTML = `
        <div class="mb-3 flex items-center justify-between">
            <span class="text-sm font-semibold">${file}</span>
            <div class="flex gap-1.5">
                <button class="btn btn-sm btn-secondary" id="structuredBtn">Structured Editor</button>
                <button class="btn btn-sm btn-primary" id="saveRawBtn">Save</button>
            </div>
        </div>
        <textarea id="rawConfigEditor" spellcheck="false"
                  class="h-[500px] w-full resize-y rounded-lg border border-border bg-card p-3.5 font-mono text-xs leading-relaxed text-foreground [tab-size:2]">${escapeHtml(rawText)}</textarea>
    `;

    // Tab key support in textarea
    container.querySelector('#rawConfigEditor')?.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.target;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
            ta.selectionStart = ta.selectionEnd = start + 2;
        }
    });

    // Structured editor button — reload tab
    container.querySelector('#structuredBtn')?.addEventListener('click', () => {
        // Trigger re-render of current file via config tab reload
        const configTab = container.closest('#tabContent');
        if (configTab) renderConfigTab(configTab, params);
    });

    // Save raw
    container.querySelector('#saveRawBtn')?.addEventListener('click', async () => {
        const text = container.querySelector('#rawConfigEditor').value;
        try {
            await api.put(`/servers/${params.id}/files/write?path=${encodeURIComponent(file)}`, { content: text });
            showToast('Config saved. Restart the server to apply changes.', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });
}

function flattenObj(obj, prefix = '') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(result, flattenObj(val, fullKey));
        } else {
            result[fullKey] = val;
        }
    }
    return result;
}

function unflattenObj(flat) {
    const result = {};
    for (const [key, val] of Object.entries(flat)) {
        const parts = key.split('.');
        let current = result;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = val;
    }
    return result;
}

// escapeHtml imported from app.js

async function renderStatsTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    let statsRange = '24h';

    async function loadStats(range) {
        statsRange = range;
        content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

        let history;
        try {
            history = await api.get(`/stats/server/${params.id}/history?range=${range}`);
        } catch {
            content.innerHTML = `
                <div class="empty-state p-10">
                    <h3>No statistics available</h3>
                    <p>Stats are collected every 5 minutes. Check back once the server has been running for a while.</p>
                </div>`;
            return;
        }

        const data = history.data || [];

        if (data.length === 0) {
            content.innerHTML = `
                <div class="empty-state p-10">
                    <h3>No statistics available</h3>
                    <p>Stats are collected every 5 minutes. Check back once the server has been running for a while.</p>
                </div>`;
            return;
        }

        // Extract chart data based on range
        let playerData, tpsData, uptimeData;

        if (range === '24h') {
            playerData = data.map(d => d.players || 0);
            tpsData = data.map(d => d.tps !== null ? d.tps : 0);
            uptimeData = data.map(d => d.online ? 1 : 0);
        } else if (range === '7d') {
            playerData = data.map(d => d.avgPlayers || 0);
            tpsData = data.map(d => d.avgTps !== null ? d.avgTps : 0);
            uptimeData = data.map(d => d.uptime ? 1 : 0);
        } else {
            playerData = data.map(d => d.avgPlayers || 0);
            tpsData = data.map(d => d.avgTps !== null ? d.avgTps : 0);
            uptimeData = data.map(d => d.totalUptime ? 1 : 0);
        }

        // Calculate summaries
        const peakPlayers = Math.max(0, ...playerData);
        const avgPlayers = playerData.length ? (playerData.reduce((a, b) => a + b, 0) / playerData.length).toFixed(1) : 0;
        const tpsValues = range === '24h'
            ? data.filter(d => d.tps !== null).map(d => d.tps)
            : data.filter(d => d.avgTps !== null).map(d => d.avgTps);
        const avgTps = tpsValues.length ? (tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length).toFixed(1) : '—';
        const onlineCount = range === '24h'
            ? data.filter(d => d.online).length
            : data.filter(d => range === '7d' ? d.uptime > 0 : d.totalUptime > 0).length;
        const uptimePercent = data.length ? Math.round((onlineCount / data.length) * 100) : 0;

        // Time label
        const rangeLabels = { '24h': 'Last 24 Hours', '7d': 'Last 7 Days', '30d': 'Last 30 Days' };

        content.innerHTML = `
            <!-- Range Selector -->
            <div class="mb-5 flex items-center justify-between">
                <span class="text-sm font-semibold">${rangeLabels[range]}</span>
                <div class="flex gap-1">
                    <button class="btn btn-sm ${range === '24h' ? 'btn-primary' : 'btn-secondary'}" data-range="24h">24h</button>
                    <button class="btn btn-sm ${range === '7d' ? 'btn-primary' : 'btn-secondary'}" data-range="7d">7d</button>
                    <button class="btn btn-sm ${range === '30d' ? 'btn-primary' : 'btn-secondary'}" data-range="30d">30d</button>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="stats-row mb-6">
                <div class="stat-card">
                    <div class="stat-label">Peak Players</div>
                    <div class="stat-value">${peakPlayers}</div>
                    <div class="stat-sub">avg ${avgPlayers}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Avg TPS</div>
                    <div class="stat-value">${avgTps}</div>
                    <div class="stat-sub">${avgTps !== '—' && avgTps >= 19 ? 'Healthy' : avgTps !== '—' ? 'Degraded' : 'No data'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Uptime</div>
                    <div class="stat-value">${uptimePercent}%</div>
                    <div class="stat-sub">${onlineCount} / ${data.length} intervals</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Data Points</div>
                    <div class="stat-value">${data.length}</div>
                    <div class="stat-sub">${range === '24h' ? '5-min intervals' : range === '7d' ? 'hourly averages' : 'daily averages'}</div>
                </div>
            </div>

            <!-- Charts -->
            <div class="grid-2 mb-4">
                <div class="chart-container">
                    <div class="chart-header">
                        <span class="chart-title">Players Online</span>
                        <span class="chart-value">${peakPlayers} peak</span>
                    </div>
                    <canvas id="statsPlayersChart" class="chart-canvas"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-header">
                        <span class="chart-title">TPS</span>
                        <span class="chart-value">${avgTps !== '—' ? avgTps : '—'}</span>
                    </div>
                    <canvas id="statsTpsChart" class="chart-canvas"></canvas>
                </div>
            </div>
            <div class="grid-2">
                <div class="chart-container">
                    <div class="chart-header">
                        <span class="chart-title">Server Uptime</span>
                        <span class="chart-value">${uptimePercent}%</span>
                    </div>
                    <canvas id="statsUptimeChart" class="chart-canvas"></canvas>
                </div>
                <div class="chart-container">
                    <div class="chart-header">
                        <span class="chart-title">Timeline</span>
                        <span class="chart-value text-xs font-normal text-muted-foreground">${data.length > 0 ? formatStatsTime(data[0].ts) + ' — ' + formatStatsTime(data[data.length - 1].ts) : ''}</span>
                    </div>
                    <canvas id="statsTimelineChart" class="chart-canvas"></canvas>
                </div>
            </div>
        `;

        // Draw charts
        const maxPlayers = Math.max(1, peakPlayers);
        drawChart('statsPlayersChart', playerData, '#d4d4d8', { maxValue: maxPlayers, showDot: true, fillAlpha: 0.12 });
        drawChart('statsTpsChart', tpsData, '#a1a1aa', { maxValue: 20, showDot: true, fillAlpha: 0.09 });
        drawChart('statsUptimeChart', uptimeData, '#71717a', { maxValue: 1, showDot: false, fillAlpha: 0.19 });

        // Timeline: use player data again with a different color for visual variety
        drawChart('statsTimelineChart', playerData, '#52525b', { maxValue: maxPlayers, showDot: false, fillAlpha: 0.08 });

        // Wire range buttons
        content.querySelectorAll('[data-range]').forEach(btn => {
            btn.addEventListener('click', () => {
                const newRange = btn.dataset.range;
                if (newRange !== statsRange) loadStats(newRange);
            });
        });
    }

    loadStats(statsRange);
}

function formatStatsTime(ts) {
    const d = new Date(ts);
    const month = d.toLocaleString('default', { month: 'short' });
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${month} ${day}, ${hours}:${mins}`;
}

async function renderPlayersTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const serverData = await api.get(`/servers/${params.id}`);
        const players = serverData.players?.list || [];

        if (players.length === 0) {
            content.innerHTML = `
                <div class="empty-state p-10">
                    <h3>No players online</h3>
                    <p>Players will appear here when they join the server.</p>
                </div>`;
            return;
        }

        content.innerHTML = `
            <div class="mb-3.5">
                <span class="text-xs text-muted-foreground">${players.length} player${players.length !== 1 ? 's' : ''} online</span>
            </div>
            <div class="overflow-hidden rounded-lg border border-border">
                ${players.map(p => `
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
        `;

        content.querySelectorAll('[data-kick]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.post(`/servers/${params.id}/command`, { command: `kick ${btn.dataset.kick}` });
                    showToast(`Kicked ${btn.dataset.kick}`, 'success');
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

        content.querySelectorAll('[data-ban]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.post(`/servers/${params.id}/command`, { command: `ban ${btn.dataset.ban}` });
                    showToast(`Banned ${btn.dataset.ban}`, 'success');
                } catch (e) { showToast(e.message, 'error'); }
            });
        });
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

async function renderFilesTab(content, params) {
    content.innerHTML = `
        <div class="empty-state px-5 py-12">
            <div class="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
            </div>
            <h3>File Manager</h3>
            <p>Browse and edit server files</p>
            <button class="btn btn-secondary" id="openFiles">Open File Manager</button>
        </div>`;

    content.querySelector('#openFiles')?.addEventListener('click', () => {
        app.navigate(`/server/${params.id}/files`);
    });
}

async function renderPropertiesTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const data = await api.get(`/servers/${params.id}/properties`);
        const props = data.properties || {};
        const meta = data.metadata || {};

        // Group properties by category
        const categories = {};
        const categoryLabels = {
            general: 'General',
            network: 'Network',
            gameplay: 'Gameplay',
            world: 'World',
            performance: 'Performance',
            security: 'Security'
        };

        // First add known properties with metadata
        for (const [key, info] of Object.entries(meta)) {
            const cat = info.category || 'general';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({
                key,
                value: props[key] !== undefined ? props[key] : info.default,
                ...info
            });
        }

        // Then add any unknown properties to "other"
        for (const [key, value] of Object.entries(props)) {
            if (!meta[key]) {
                if (!categories['other']) categories['other'] = [];
                categories['other'].push({ key, value, type: 'string', description: '' });
            }
        }

        const categoryOrder = ['general', 'gameplay', 'world', 'network', 'performance', 'security', 'other'];

        content.innerHTML = `
            <div class="max-w-[680px]">
                <div class="mb-5 flex items-center justify-between">
                    <div>
                        <div class="text-sm font-semibold tracking-tight">server.properties</div>
                        <div class="mt-0.5 text-xs text-muted-foreground">Changes require a server restart to take effect.</div>
                    </div>
                    <button class="btn btn-primary" id="saveProps">Save Properties</button>
                </div>

                ${categoryOrder.filter(cat => categories[cat]?.length).map(cat => `
                    <div class="properties-group">
                        <div class="properties-group-title">${categoryLabels[cat] || 'Other'}</div>
                        ${categories[cat].map(prop => `
                            <div class="property-row">
                                <div class="property-label">${escapeHtml(prop.key)}</div>
                                <div class="property-input">
                                    ${renderPropertyInput(prop)}
                                </div>
                                ${prop.description ? `<div class="property-desc">${escapeHtml(prop.description)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `;

        // Wire save
        content.querySelector('#saveProps')?.addEventListener('click', async () => {
            const updatedProps = {};
            content.querySelectorAll('[data-prop]').forEach(input => {
                const key = input.dataset.prop;
                if (input.type === 'checkbox') {
                    updatedProps[key] = input.checked ? 'true' : 'false';
                } else {
                    updatedProps[key] = input.value;
                }
            });

            try {
                await api.put(`/servers/${params.id}/properties`, { properties: updatedProps });
                showToast('Properties saved. Restart server to apply.', 'success');
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function renderPropertyInput(prop) {
    const val = prop.value !== undefined ? prop.value : (prop.default || '');

    if (prop.type === 'boolean') {
        return `<input type="checkbox" data-prop="${escapeHtml(prop.key)}" ${val === 'true' ? 'checked' : ''} class="accent-white">`;
    }
    if (prop.type === 'select' && prop.options) {
        return `<select class="form-select max-w-[200px]" data-prop="${escapeHtml(prop.key)}">
            ${prop.options.map(o => `<option value="${escapeHtml(o)}" ${val === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>`;
    }
    if (prop.type === 'number') {
        return `<input type="number" class="form-input max-w-[160px]" data-prop="${escapeHtml(prop.key)}" value="${escapeHtml(String(val))}" ${prop.min !== undefined ? `min="${prop.min}"` : ''} ${prop.max !== undefined ? `max="${prop.max}"` : ''}>`;
    }
    return `<input type="text" class="form-input" data-prop="${escapeHtml(prop.key)}" value="${escapeHtml(String(val))}">`;
}

async function renderPluginsTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const data = await api.get(`/servers/${params.id}/plugins`);
        const plugins = data.plugins || [];

        content.innerHTML = `
            <div class="mb-4 flex items-center justify-between">
                <span class="text-xs text-muted-foreground">${plugins.length} plugin${plugins.length !== 1 ? 's' : ''} / mod${plugins.length !== 1 ? 's' : ''}</span>
                <div class="flex gap-2">
                    <button class="btn btn-secondary btn-sm" id="browseModrinth">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        Browse Modrinth
                    </button>
                    <label class="btn btn-secondary btn-sm cursor-pointer">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Upload
                        <input type="file" accept=".jar" id="pluginUpload" class="hidden">
                    </label>
                </div>
            </div>

            ${plugins.length === 0 ? `
                <div class="empty-state p-10">
                    <h3>No plugins or mods</h3>
                    <p>Upload .jar files or they'll appear when the server generates a plugins/ or mods/ folder.</p>
                </div>
            ` : `
                <div class="overflow-hidden rounded-lg border border-border">
                    ${plugins.map((p, i) => `
                        <div class="flex items-center justify-between px-4 py-3 ${i < plugins.length - 1 ? 'border-b border-border' : ''}">
                            <div class="flex min-w-0 flex-1 items-center gap-2.5">
                                <div class="h-2 w-2 flex-shrink-0 rounded-full ${p.enabled ? 'bg-foreground' : 'bg-muted-foreground/40'}"></div>
                                <div class="min-w-0">
                                    <div class="truncate text-sm font-medium">${escapeHtml(p.name)}</div>
                                    <div class="text-[11px] text-muted-foreground">${escapeHtml(p.folder)} &middot; ${formatPluginSize(p.size)}</div>
                                </div>
                            </div>
                            <div class="flex shrink-0 gap-1.5">
                                <button class="btn btn-sm btn-secondary" data-toggle-plugin='${JSON.stringify({filename: p.filename, folder: p.folder})}'>${p.enabled ? 'Disable' : 'Enable'}</button>
                                <button class="btn btn-sm btn-danger" data-delete-plugin='${JSON.stringify({filename: p.filename, folder: p.folder})}'>Delete</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        `;

        // Upload handler
        content.querySelector('#pluginUpload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await api.upload(`/servers/${params.id}/plugins/upload?folder=plugins`, file);
                showToast(`Uploaded ${file.name}`, 'success');
                renderPluginsTab(content, params);
            } catch (err) { showToast(err.message, 'error'); }
        });

        // Browse Modrinth
        content.querySelector('#browseModrinth')?.addEventListener('click', () => {
            renderModrinthBrowser(content, params);
        });

        // Toggle handlers
        content.querySelectorAll('[data-toggle-plugin]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const data = JSON.parse(btn.dataset.togglePlugin);
                try {
                    await api.post(`/servers/${params.id}/plugins/toggle`, data);
                    showToast('Plugin toggled. Restart to apply.', 'success');
                    renderPluginsTab(content, params);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

        // Delete handlers
        content.querySelectorAll('[data-delete-plugin]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const data = JSON.parse(btn.dataset.deletePlugin);
                showModal('Delete Plugin', `<p>Delete <strong>${data.filename}</strong>?</p>`, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                        try {
                            await api.request('DELETE', `/servers/${params.id}/plugins`, data);
                            showToast('Plugin deleted', 'success');
                            renderPluginsTab(content, params);
                        } catch (err) { showToast(err.message, 'error'); }
                    }}
                ]);
            });
        });
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function formatPluginSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function renderModrinthBrowser(content, params) {
    const platform = server.type || 'paper';
    const version = server.version || '';

    content.innerHTML = `
        <div class="mb-4 flex items-center justify-between">
            <button class="btn btn-secondary btn-sm" id="backToPlugins">&larr; Back to plugins</button>
            <span class="text-xs text-muted-foreground">Modrinth Plugin Browser</span>
        </div>
        <div class="mb-4 flex gap-2">
            <input type="text" class="form-input flex-1 text-sm" id="modrinthSearch" placeholder="Search plugins & mods...">
            <button class="btn btn-primary btn-sm" id="modrinthSearchBtn">Search</button>
        </div>
        <div id="modrinthResults"></div>
    `;

    content.querySelector('#backToPlugins')?.addEventListener('click', () => renderPluginsTab(content, params));

    const doSearch = async () => {
        const query = content.querySelector('#modrinthSearch')?.value || '';
        const results = content.querySelector('#modrinthResults');
        results.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

        try {
            const data = await api.get(`/servers/modrinth/search?q=${encodeURIComponent(query)}&version=${encodeURIComponent(version)}&platform=${encodeURIComponent(platform)}`);
            const items = data.results || [];

            if (items.length === 0) {
                results.innerHTML = '<div class="empty-state p-10"><h3>No results</h3><p>Try different search terms.</p></div>';
                return;
            }

            results.innerHTML = `
                <div class="overflow-hidden rounded-lg border border-border">
                    ${items.map((p, i) => `
                        <div class="flex items-center gap-3 px-4 py-3.5 ${i < items.length - 1 ? 'border-b border-border' : ''}" data-modrinth-id="${p.id}">
                            <div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                                ${p.iconUrl ? `<img src="${p.iconUrl}" width="40" height="40" class="object-cover" loading="lazy">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>'}
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="truncate text-sm font-semibold">${escapeHtml(p.name)}</div>
                                <div class="mt-0.5 truncate text-[11px] text-muted-foreground">${escapeHtml(p.description)}</div>
                                <div class="mt-1 text-[10px] text-muted-foreground">${escapeHtml(p.author)} &middot; ${formatDownloads(p.downloads)} downloads &middot; ${escapeHtml(p.projectType)}</div>
                            </div>
                            <button class="btn btn-sm btn-primary shrink-0" data-install-modrinth="${escapeHtml(p.id)}" data-project-name="${escapeHtml(p.name)}">Install</button>
                        </div>
                    `).join('')}
                </div>
            `;

            // Wire install buttons
            results.querySelectorAll('[data-install-modrinth]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const projectId = btn.dataset.installModrinth;
                    const projectName = btn.dataset.projectName;
                    btn.disabled = true;
                    btn.textContent = 'Loading...';

                    try {
                        // Get versions for this project
                        const loaders = platform === 'forge' ? 'forge' : platform === 'fabric' ? 'fabric' : 'paper,spigot,bukkit';
                        const vData = await api.get(`/servers/modrinth/versions/${projectId}?gameVersion=${encodeURIComponent(version)}&loaders=${encodeURIComponent(loaders)}`);
                        const versions = vData.versions || [];

                        if (versions.length === 0) {
                            showToast('No compatible version found for your server', 'error');
                            btn.disabled = false;
                            btn.textContent = 'Install';
                            return;
                        }

                        // Pick first (latest) version's primary file
                        const latest = versions[0];
                        const file = latest.files.find(f => f.primary) || latest.files[0];
                        if (!file) {
                            showToast('No downloadable file found', 'error');
                            btn.disabled = false;
                            btn.textContent = 'Install';
                            return;
                        }

                        // Determine folder (mods for fabric/forge, plugins for paper/spigot/bukkit)
                        const folder = (platform === 'forge' || platform === 'fabric') ? 'mods' : 'plugins';

                        btn.textContent = 'Installing...';
                        await api.post(`/servers/${params.id}/plugins/install-remote`, {
                            downloadUrl: file.url,
                            filename: file.filename,
                            folder
                        });

                        showToast(`Installed ${projectName}`, 'success');
                        btn.textContent = 'Installed';
                        btn.classList.remove('btn-primary');
                        btn.classList.add('btn-secondary');
                    } catch (e) {
                        showToast(e.message, 'error');
                        btn.disabled = false;
                        btn.textContent = 'Install';
                    }
                });
            });
        } catch (e) {
            results.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
        }
    };

    content.querySelector('#modrinthSearchBtn')?.addEventListener('click', doSearch);
    content.querySelector('#modrinthSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
    });

    // Auto-search with empty query to show popular
    doSearch();
}

function formatDownloads(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

async function renderBackupsTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const data = await api.get(`/servers/${params.id}/backups`);
        const backups = data.backups || [];

        content.innerHTML = `
            <div class="mb-4 flex items-center justify-between">
                <span class="text-xs text-muted-foreground">${backups.length} backup${backups.length !== 1 ? 's' : ''}</span>
                <button class="btn btn-primary btn-sm" id="createBackup">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Create Backup
                </button>
            </div>

            ${backups.length === 0 ? `
                <div class="empty-state p-10">
                    <h3>No backups</h3>
                    <p>Create a backup to snapshot your server files.</p>
                </div>
            ` : `
                <div class="overflow-hidden rounded-lg border border-border">
                    ${backups.map((b, i) => `
                        <div class="flex items-center justify-between px-4 py-3.5 ${i < backups.length - 1 ? 'border-b border-border' : ''}">
                            <div>
                                <div class="text-sm font-medium">${escapeHtml(b.filename)}</div>
                                <div class="mt-0.5 text-[11px] text-muted-foreground">
                                    ${formatPluginSize(b.size)} &middot; ${new Date(b.createdAt).toLocaleString()} &middot; by ${escapeHtml(b.createdBy)}
                                </div>
                            </div>
                            <div class="flex gap-1.5">
                                <button class="btn btn-sm btn-secondary" data-restore="${escapeHtml(b.filename)}">Restore</button>
                                <button class="btn btn-sm btn-danger" data-delete-backup="${escapeHtml(b.filename)}">Delete</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        `;

        // Create backup
        content.querySelector('#createBackup')?.addEventListener('click', async () => {
            const btn = content.querySelector('#createBackup');
            btn.disabled = true;
            btn.textContent = 'Creating...';
            try {
                await api.post(`/servers/${params.id}/backups`);
                showToast('Backup created!', 'success');
                renderBackupsTab(content, params);
            } catch (e) {
                showToast(e.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Create Backup';
            }
        });

        // Restore
        content.querySelectorAll('[data-restore]').forEach(btn => {
            btn.addEventListener('click', () => {
                const filename = btn.dataset.restore;
                showModal('Restore Backup', `
                    <p class="mb-3">Restore from <strong>${filename}</strong>?</p>
                    <p class="text-xs text-muted-foreground">This will overwrite current server files. The server must be stopped.</p>
                `, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'restore', label: 'Restore', class: 'btn-primary', onClick: async () => {
                        try {
                            await api.post(`/servers/${params.id}/backups/restore`, { filename });
                            showToast('Backup restored!', 'success');
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        });

        // Delete backup
        content.querySelectorAll('[data-delete-backup]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.del(`/servers/${params.id}/backups/${btn.dataset.deleteBackup}`);
                    showToast('Backup deleted', 'success');
                    renderBackupsTab(content, params);
                } catch (e) { showToast(e.message, 'error'); }
            });
        });
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

async function renderStartupTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const data = await api.get(`/startup/${params.id}`);
        const vars = data.variables || [];
        const custom = data.customVariables || [];

        content.innerHTML = `
            <div class="max-w-[640px]">
                <div class="page-header mb-5">
                    <div>
                        <div class="text-sm font-semibold tracking-tight">Startup Configuration</div>
                        <div class="mt-0.5 text-xs text-muted-foreground">Configure how the server starts. Changes require restart.</div>
                    </div>
                    <button class="btn btn-primary btn-sm" id="saveStartup">Save</button>
                </div>

                <div class="settings-card mb-5">
                    <div class="settings-card-header">
                        <span class="settings-card-title text-xs">Startup Command</span>
                    </div>
                    <div class="settings-card-body px-5 py-3.5">
                        <input type="text" class="form-input font-mono text-xs" id="startupCommand" value="${data.startupCommand || ''}">
                        <div class="mt-1.5 text-[11px] text-muted-foreground">Use <code>{{VARIABLE}}</code> syntax. Resolved: <span class="text-foreground">${data.resolvedCommand || ''}</span></div>
                    </div>
                </div>

                <div class="settings-card mb-5">
                    <div class="settings-card-header">
                        <span class="settings-card-title text-xs">Variables</span>
                    </div>
                    <div class="p-0">
                        ${vars.map((v, i) => `
                            <div class="flex items-center gap-3 px-5 py-3 ${i < vars.length - 1 ? 'border-b border-border' : ''}">
                                <div class="min-w-[140px]">
                                    <div class="text-xs font-medium">${escapeHtml(v.label)}</div>
                                    <div class="font-mono text-[10px] text-muted-foreground">{{${escapeHtml(v.key)}}}</div>
                                </div>
                                <div class="flex-1">
                                    ${v.type === 'select' && v.options ? `
                                        <select class="form-select text-xs" data-startup-var="${escapeHtml(v.key)}">
                                            ${v.options.map(o => `<option value="${escapeHtml(o)}" ${o === v.value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
                                        </select>
                                    ` : `
                                        <input type="text" class="form-input text-xs" data-startup-var="${escapeHtml(v.key)}" value="${escapeHtml(v.value || '')}">
                                    `}
                                </div>
                            </div>
                        `).join('')}
                        ${custom.map((v, i) => `
                            <div class="flex items-center gap-3 border-t border-border px-5 py-3">
                                <div class="min-w-[140px]">
                                    <div class="text-xs font-medium">${escapeHtml(v.label)}</div>
                                    <div class="font-mono text-[10px] text-muted-foreground">{{${escapeHtml(v.key)}}}</div>
                                </div>
                                <div class="flex-1">
                                    <input type="text" class="form-input text-xs" data-startup-var="${escapeHtml(v.key)}" value="${escapeHtml(v.value || '')}">
                                </div>
                                <button class="btn btn-sm btn-danger" data-remove-var="${escapeHtml(v.key)}">Remove</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="settings-card-footer justify-start">
                        <button class="btn btn-secondary btn-sm" id="addVariable">+ Add Variable</button>
                    </div>
                </div>
            </div>
        `;

        // Save startup
        content.querySelector('#saveStartup')?.addEventListener('click', async () => {
            const variables = {};
            content.querySelectorAll('[data-startup-var]').forEach(el => {
                variables[el.dataset.startupVar] = el.value;
            });
            try {
                await api.put(`/startup/${params.id}`, {
                    variables,
                    startupCommand: content.querySelector('#startupCommand').value
                });
                showToast('Startup configuration saved', 'success');
            } catch (e) { showToast(e.message, 'error'); }
        });

        // Remove custom variable
        content.querySelectorAll('[data-remove-var]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.del(`/startup/${params.id}/variable/${btn.dataset.removeVar}`);
                    showToast('Variable removed', 'success');
                    renderStartupTab(content, params);
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

        // Add variable
        content.querySelector('#addVariable')?.addEventListener('click', () => {
            showModal('Add Custom Variable', `
                <div class="form-group">
                    <label class="form-label">Variable Key</label>
                    <input type="text" class="form-input font-mono" id="varKey" placeholder="MY_VARIABLE">
                </div>
                <div class="form-group">
                    <label class="form-label">Label</label>
                    <input type="text" class="form-input" id="varLabel" placeholder="My Variable">
                </div>
                <div class="form-group mb-0">
                    <label class="form-label">Default Value</label>
                    <input type="text" class="form-input" id="varValue">
                </div>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'add', label: 'Add', class: 'btn-primary', onClick: async () => {
                    const key = document.querySelector('#varKey')?.value?.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                    const label = document.querySelector('#varLabel')?.value;
                    const value = document.querySelector('#varValue')?.value;
                    if (!key) { showToast('Variable key required', 'error'); return; }
                    try {
                        await api.post(`/startup/${params.id}/add-variable`, { key, label, value });
                        showToast('Variable added', 'success');
                        renderStartupTab(content, params);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        });
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

// ─── Permissions Tab ─────────────────────────────────────────────
async function renderPermissionsTab(content, params) {
    content.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const [permData, subData] = await Promise.all([
            api.get('/permissions'),
            api.get(`/permissions/server/${params.id}`)
        ]);

        const allPermissions = permData.permissions || {};
        const rolePresets = permData.rolePresets || {};
        const subusers = subData.subusers || [];

        // Group permissions by category
        const permGroups = {};
        for (const [key, desc] of Object.entries(allPermissions)) {
            const cat = key.split('.')[0];
            if (!permGroups[cat]) permGroups[cat] = [];
            permGroups[cat].push({ key, desc });
        }

        const catLabels = {
            server: 'Server Control',
            file: 'File Management',
            player: 'Player Management',
            backup: 'Backups',
            plugin: 'Plugins',
            schedule: 'Scheduling',
            user: 'Administration'
        };

        content.innerHTML = `
            <div class="max-w-[700px]">
                <div class="mb-5">
                    <div class="text-sm font-semibold tracking-tight">Subuser Permissions</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">Manage what each user can do on this server. Admins always have full access.</div>
                </div>

                ${subusers.length === 0 ? `
                    <div class="empty-state p-10">
                        <h3>No subusers</h3>
                        <p>Add users in Settings first, then manage their per-server permissions here.</p>
                    </div>
                ` : `
                    <div class="flex flex-col gap-4">
                        ${subusers.map(user => `
                            <div class="overflow-hidden rounded-lg border border-border bg-card" data-perm-user="${escapeHtml(user.username)}">
                                <div class="flex cursor-pointer items-center justify-between border-b border-border px-5 py-3.5" data-perm-toggle="${escapeHtml(user.username)}">
                                    <div class="flex items-center gap-2.5">
                                        <div class="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold">${escapeHtml(user.username.charAt(0).toUpperCase())}</div>
                                        <div>
                                            <span class="text-sm font-medium">${escapeHtml(user.username)}</span>
                                            <span class="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">${escapeHtml(user.role)}</span>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        ${user.hasCustomPermissions ? '<span class="rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground">Custom</span>' : '<span class="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Role Default</span>'}
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="perm-chevron-${escapeHtml(user.username)} transition-transform duration-150"><polyline points="6 9 12 15 18 9"/></svg>
                                    </div>
                                </div>
                                    <div class="hidden p-0" data-perm-body="${escapeHtml(user.username)}">
                                    ${user.role === 'admin' ? `
                                        <div class="p-5 text-center text-xs text-muted-foreground">
                                            Admins have all permissions on all servers.
                                        </div>
                                    ` : `
                                        <div class="px-5 py-4">
                                            <!-- Quick presets -->
                                            <div class="mb-4 flex gap-2">
                                                <button class="btn btn-sm btn-secondary" data-preset-role="${escapeHtml(user.username)}" data-preset="operator">Apply Operator</button>
                                                <button class="btn btn-sm btn-secondary" data-preset-role="${escapeHtml(user.username)}" data-preset="viewer">Apply Viewer</button>
                                                <button class="btn btn-sm btn-secondary" data-preset-role="${escapeHtml(user.username)}" data-preset="all">Select All</button>
                                                <button class="btn btn-sm btn-secondary" data-preset-role="${escapeHtml(user.username)}" data-preset="none">Clear All</button>
                                            </div>
                                            ${Object.entries(permGroups).map(([cat, perms]) => `
                                                <div class="mb-3.5">
                                                    <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">${catLabels[cat] || cat}</div>
                                                    <div class="grid grid-cols-1 gap-1 md:grid-cols-2">
                                                        ${perms.map(p => `
                                                            <label class="flex cursor-pointer items-start gap-2 py-1 text-xs text-muted-foreground">
                                                                <input type="checkbox" data-perm-check="${escapeHtml(user.username)}" data-perm-key="${escapeHtml(p.key)}" ${user.permissions.includes(p.key) ? 'checked' : ''} class="mt-0.5 accent-white">
                                                                <div>
                                                                    <div class="text-xs font-medium text-foreground">${escapeHtml(p.key)}</div>
                                                                    <div class="text-[10px] text-muted-foreground">${escapeHtml(p.desc)}</div>
                                                                </div>
                                                            </label>
                                                        `).join('')}
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                        <div class="flex justify-between border-t border-border px-5 py-3">
                                            <button class="btn btn-sm btn-secondary" data-reset-perms="${escapeHtml(user.username)}">Reset to Role Default</button>
                                            <button class="btn btn-sm btn-primary" data-save-perms="${escapeHtml(user.username)}">Save Permissions</button>
                                        </div>
                                    `}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;

        // Wire expand/collapse
        content.querySelectorAll('[data-perm-toggle]').forEach(header => {
            header.addEventListener('click', () => {
                const username = header.dataset.permToggle;
                const body = content.querySelector(`[data-perm-body="${username}"]`);
                const chevron = content.querySelector(`.perm-chevron-${username}`);
                if (body) {
                    const isOpen = !body.classList.contains('hidden');
                    body.classList.toggle('hidden', isOpen);
                    if (chevron) chevron.classList.toggle('rotate-180', !isOpen);
                }
            });
        });

        // Wire preset buttons
        content.querySelectorAll('[data-preset-role]').forEach(btn => {
            btn.addEventListener('click', () => {
                const username = btn.dataset.presetRole;
                const preset = btn.dataset.preset;
                const checkboxes = content.querySelectorAll(`[data-perm-check="${username}"]`);

                let targetPerms = [];
                if (preset === 'all') targetPerms = Object.keys(allPermissions);
                else if (preset === 'none') targetPerms = [];
                else if (rolePresets[preset]) targetPerms = rolePresets[preset];

                checkboxes.forEach(cb => {
                    cb.checked = targetPerms.includes(cb.dataset.permKey);
                });
            });
        });

        // Wire save buttons
        content.querySelectorAll('[data-save-perms]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const username = btn.dataset.savePerms;
                const checked = content.querySelectorAll(`[data-perm-check="${username}"]:checked`);
                const permissions = Array.from(checked).map(cb => cb.dataset.permKey);

                try {
                    await api.put(`/permissions/server/${params.id}/user/${username}`, { permissions });
                    showToast(`Permissions saved for ${username}`, 'success');
                    // Update badge
                    renderPermissionsTab(content, params);
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

        // Wire reset buttons
        content.querySelectorAll('[data-reset-perms]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const username = btn.dataset.resetPerms;
                try {
                    await api.del(`/permissions/server/${params.id}/user/${username}`);
                    showToast(`Permissions reset for ${username}`, 'success');
                    renderPermissionsTab(content, params);
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

    } catch (e) {
        content.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

async function renderSettingsTab(content, params) {
    // Load resource limits
    let resourceData = { limits: { cpuPercent: 0, memoryMB: 0, diskMB: 0 }, usage: {} };
    try {
        resourceData = await api.get(`/resources/${params.id}`);
    } catch (e) {}
    const limits = resourceData.limits || {};

    content.innerHTML = `
        <div class="flex max-w-[520px] flex-col gap-5">
            <!-- Server Config -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <span class="settings-card-title">Server Configuration</span>
                </div>
                <div class="settings-card-body">
                    <div class="form-group">
                        <label class="form-label">Server Name</label>
                        <input type="text" class="form-input" id="settName" value="${server.name}">
                    </div>
                    <div class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                        <div class="form-group">
                            <label class="form-label">Min Memory</label>
                            <select class="form-select" id="settMemMin">
                                ${['512M','1G','2G','3G','4G'].map(v => `<option value="${v}" ${v === server.memory?.min ? 'selected' : ''}>${v}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Max Memory</label>
                            <select class="form-select" id="settMemMax">
                                ${['1G','2G','3G','4G','6G','8G','12G','16G'].map(v => `<option value="${v}" ${v === server.memory?.max ? 'selected' : ''}>${v}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Custom JVM Arguments</label>
                        <input type="text" class="form-input" id="settJvmArgs" value="${(server.jvmArgs || []).join(' ')}" placeholder="-XX:+UseG1GC -Dfml.readTimeout=180">
                        <div class="form-hint">Space-separated JVM flags. Requires restart to apply.</div>
                    </div>
                    <div class="form-group mb-0">
                        <label class="form-label flex cursor-pointer items-center gap-2 text-foreground">
                            <input type="checkbox" id="settAutoStart" ${server.autoStart ? 'checked' : ''} class="accent-white">
                            Auto-start on panel launch
                        </label>
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="saveSettings">Save Settings</button>
                </div>
            </div>

            <!-- Auto-Restart -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <span class="settings-card-title">Crash Detection</span>
                    <p class="settings-card-desc">Automatically restart the server if it crashes unexpectedly</p>
                </div>
                <div class="settings-card-body">
                    <div class="form-group">
                        <label class="form-label flex cursor-pointer items-center gap-2 text-foreground">
                            <input type="checkbox" id="settAutoRestart" ${server.autoRestart ? 'checked' : ''} class="accent-white">
                            Enable auto-restart on crash
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Max auto-restart attempts</label>
                        <input type="number" class="form-input max-w-[120px]" id="settMaxRestarts" value="${server.maxAutoRestarts ?? 3}" min="1" max="10">
                        <div class="form-hint">After this many consecutive crashes, auto-restart stops.</div>
                    </div>
                    <div class="form-group mb-0">
                        <label class="form-label">Crash cooldown (seconds)</label>
                        <input type="number" class="form-input max-w-[120px]" id="settCrashCooldown" value="${Math.round((server.crashCooldown || 300000) / 1000)}" min="30" max="600">
                        <div class="form-hint">Counter resets after this many seconds of stability.</div>
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="saveAutoRestart">Save</button>
                </div>
            </div>

            <!-- Crash History -->
            ${(server.crashHistory && server.crashHistory.length > 0) ? `
            <div class="settings-card">
                <div class="settings-card-header">
                    <span class="settings-card-title">Crash History</span>
                    <p class="settings-card-desc">Last ${server.crashHistory.length} crash${server.crashHistory.length !== 1 ? 'es' : ''}</p>
                </div>
                <div class="max-h-[280px] overflow-y-auto p-0">
                    ${[...server.crashHistory].reverse().map(c => `
                        <div class="list-item px-5 py-2.5">
                            <div class="flex items-center gap-2.5">
                                <span class="text-foreground">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </span>
                                <div>
                                    <div class="text-xs font-medium">Exit code ${c.exitCode} <span class="font-normal text-muted-foreground">&middot; Crash #${c.crashNumber}</span></div>
                                    <div class="mt-0.5 text-[11px] text-muted-foreground">${new Date(c.timestamp).toLocaleString()} &middot; ${c.restartAttempted ? 'Auto-restarted' : 'No restart'}</div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- Resource Limits -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <span class="settings-card-title">Resource Limits</span>
                    <p class="settings-card-desc">Set 0 for unlimited</p>
                </div>
                <div class="settings-card-body">
                    <div class="grid grid-cols-1 gap-3.5 md:grid-cols-3">
                        <div class="form-group mb-0">
                            <label class="form-label">CPU Limit (%)</label>
                            <input type="number" class="form-input" id="limCpu" value="${limits.cpuPercent || 0}" min="0" max="400" step="10">
                        </div>
                        <div class="form-group mb-0">
                            <label class="form-label">Memory (MB)</label>
                            <input type="number" class="form-input" id="limMem" value="${limits.memoryMB || 0}" min="0" step="256">
                        </div>
                        <div class="form-group mb-0">
                            <label class="form-label">Disk (MB)</label>
                            <input type="number" class="form-input" id="limDisk" value="${limits.diskMB || 0}" min="0" step="1024">
                        </div>
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="saveLimits">Save Limits</button>
                </div>
            </div>

            <!-- Transfer -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <span class="settings-card-title">Transfer</span>
                </div>
                <div class="p-0">
                    <div class="list-item">
                        <div>
                            <div class="text-sm font-medium">Clone Server</div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">Create a copy with a new port</div>
                        </div>
                        <button class="btn btn-sm btn-secondary" id="cloneBtn">Clone</button>
                    </div>
                    <div class="list-item">
                        <div>
                            <div class="text-sm font-medium">Save as Template</div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">Save config as a reusable template for new servers</div>
                        </div>
                        <button class="btn btn-sm btn-secondary" id="templateBtn">Save Template</button>
                    </div>
                    <div class="list-item">
                        <div>
                            <div class="text-sm font-medium">Export Server</div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">Download all server files as a zip archive</div>
                        </div>
                        <a href="/api/servers/${params.id}/export" class="btn btn-sm btn-secondary" id="exportBtn">Export</a>
                    </div>
                </div>
            </div>

            <!-- Danger Zone -->
            <div class="settings-card border-border">
                <div class="settings-card-header border-border">
                    <span class="settings-card-title text-foreground">Danger Zone</span>
                </div>
                <div class="p-0">
                    <div class="list-item">
                        <div>
                            <div class="text-sm font-medium">${server.suspended ? 'Unsuspend Server' : 'Suspend Server'}</div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">${server.suspended ? 'Re-enable the server so it can be started' : 'Prevent the server from being started'}</div>
                        </div>
                        <button class="btn btn-sm ${server.suspended ? 'btn-success' : 'btn-danger'}" id="suspendBtn">${server.suspended ? 'Unsuspend' : 'Suspend'}</button>
                    </div>
                    <div class="list-item">
                        <div>
                            <div class="text-sm font-medium">Reinstall Server</div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">Delete all files except the JAR and reset to fresh state</div>
                        </div>
                        <button class="btn btn-sm btn-danger" id="reinstallBtn">Reinstall</button>
                    </div>
                    <div class="list-item">
                        <div>
                            <div class="text-sm font-medium">Delete Server</div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">Permanently delete this server and all its files</div>
                        </div>
                        <button class="btn btn-sm btn-danger" id="settDeleteBtn">Delete</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Save settings
    content.querySelector('#saveSettings')?.addEventListener('click', async () => {
        try {
            const jvmArgsStr = content.querySelector('#settJvmArgs').value;
            await api.patch(`/servers/${params.id}`, {
                name: content.querySelector('#settName').value,
                memory: {
                    min: content.querySelector('#settMemMin').value,
                    max: content.querySelector('#settMemMax').value
                },
                jvmArgs: jvmArgsStr ? jvmArgsStr.split(/\s+/).filter(Boolean) : [],
                autoStart: content.querySelector('#settAutoStart').checked
            });
            showToast('Settings saved', 'success');
            server.name = content.querySelector('#settName').value;
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Save auto-restart settings
    content.querySelector('#saveAutoRestart')?.addEventListener('click', async () => {
        try {
            const result = await api.patch(`/servers/${params.id}/auto-restart`, {
                autoRestart: content.querySelector('#settAutoRestart').checked,
                maxAutoRestarts: parseInt(content.querySelector('#settMaxRestarts').value) || 3,
                crashCooldown: (parseInt(content.querySelector('#settCrashCooldown').value) || 300) * 1000
            });
            server.autoRestart = result.autoRestart;
            server.maxAutoRestarts = result.maxAutoRestarts;
            server.crashCooldown = result.crashCooldown;
            showToast('Auto-restart settings saved', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    });

    // Save resource limits
    content.querySelector('#saveLimits')?.addEventListener('click', async () => {
        try {
            await api.put(`/resources/${params.id}`, {
                cpuPercent: parseInt(content.querySelector('#limCpu').value) || 0,
                memoryMB: parseInt(content.querySelector('#limMem').value) || 0,
                diskMB: parseInt(content.querySelector('#limDisk').value) || 0
            });
            showToast('Resource limits saved', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    });

    // Clone server
    content.querySelector('#cloneBtn')?.addEventListener('click', () => {
        showModal('Clone Server', `
            <div class="form-group">
                <label class="form-label">New Server Name</label>
                <input type="text" class="form-input" id="cloneName" value="Copy of ${server.name}">
            </div>
            <div class="form-group mb-1">
                <label class="form-label flex cursor-pointer items-center gap-2 text-foreground">
                    <input type="checkbox" id="cloneCopyWorld" checked class="accent-white">
                    Copy world data
                </label>
                <div class="form-hint">Include world, nether, and end dimensions</div>
            </div>
            <div class="form-group mb-0">
                <label class="form-label flex cursor-pointer items-center gap-2 text-foreground">
                    <input type="checkbox" id="cloneCopyPlugins" checked class="accent-white">
                    Copy plugins/mods
                </label>
                <div class="form-hint">Include plugins and mods directories</div>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'clone', label: 'Clone', class: 'btn-primary', onClick: async () => {
                const name = document.querySelector('#cloneName')?.value;
                const copyWorld = document.querySelector('#cloneCopyWorld')?.checked ?? true;
                const copyPlugins = document.querySelector('#cloneCopyPlugins')?.checked ?? true;
                try {
                    const result = await api.post(`/servers/${params.id}/clone`, { name, copyWorld, copyPlugins });
                    showToast(`Server cloned as "${result.name}"`, 'success');
                    app.navigate(`/server/${result.id}`);
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });

    // Save as template
    content.querySelector('#templateBtn')?.addEventListener('click', () => {
        showModal('Save as Template', `
            <div class="form-group mb-0">
                <label class="form-label">Template Name</label>
                <input type="text" class="form-input" id="templateName" value="${server.name} Template" placeholder="My Template">
                <div class="form-hint">This saves the server type, version, memory, and JVM settings as a reusable template.</div>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'save', label: 'Save Template', class: 'btn-primary', onClick: async () => {
                const name = document.querySelector('#templateName')?.value;
                if (!name?.trim()) { showToast('Template name required', 'error'); return; }
                try {
                    await api.post('/templates', { serverId: params.id, name: name.trim() });
                    showToast(`Template "${name}" saved`, 'success');
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });

    // Suspend/Unsuspend
    content.querySelector('#suspendBtn')?.addEventListener('click', async () => {
        const action = server.suspended ? 'unsuspend' : 'suspend';
        if (!server.suspended) {
            showModal('Suspend Server', `
                <p>Suspend <strong>${escapeHtml(server.name)}</strong>? It will be stopped and cannot be started until unsuspended.</p>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'suspend', label: 'Suspend', class: 'btn-danger', onClick: async () => {
                    try {
                        await api.post(`/servers/${params.id}/suspend`);
                        server.suspended = true;
                        server.status = 'stopped';
                        showToast('Server suspended', 'success');
                        renderPage(content.closest('.page-enter-active, .page-enter, [class*="page"]')?.parentNode || content.parentNode, params);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        } else {
            try {
                await api.post(`/servers/${params.id}/unsuspend`);
                server.suspended = false;
                showToast('Server unsuspended', 'success');
                renderSettingsTab(content, params);
            } catch (e) { showToast(e.message, 'error'); }
        }
    });

    // Reinstall
    content.querySelector('#reinstallBtn')?.addEventListener('click', () => {
        showModal('Reinstall Server', `
            <p class="mb-3">This will <strong>delete all server files</strong> except the JAR file and reset to a fresh state.</p>
            <p class="text-xs text-muted-foreground">The server must be stopped. Consider creating a backup first.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'reinstall', label: 'Reinstall', class: 'btn-danger', onClick: async () => {
                try {
                    await api.post(`/servers/${params.id}/reinstall`);
                    showToast('Server reinstalled', 'success');
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });

    // Delete
    content.querySelector('#settDeleteBtn')?.addEventListener('click', () => {
        showModal('Delete Server', `
            <p class="mb-3">Are you sure you want to delete <strong class="text-foreground">${server.name}</strong>?</p>
            <p class="text-xs text-muted-foreground">This will permanently delete all server files.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                try {
                    await api.del(`/servers/${params.id}`);
                    showToast('Server deleted', 'success');
                    app.navigate('/');
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });
}

// ==================== DNS TAB ====================

async function renderDnsTab(content, params) {
    // Re-fetch so we always render against fresh DNS state
    try {
        server = await api.get(`/servers/${params.id}`);
    } catch (e) {
        content.innerHTML = `<div class="empty-state p-10"><h3>Failed to load server</h3><p>${escapeHtml(e.message)}</p></div>`;
        return;
    }

    const dns = server.dns;

    if (!dns || !dns.providerId) {
        content.innerHTML = `
            <div class="empty-state-dashed p-12 text-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-3">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <h3 class="mb-1 text-sm font-medium text-foreground">No DNS Configured</h3>
                <p class="mb-4 text-xs text-muted-foreground">Point a domain at this server. A and SRV records will be created so players can connect using your domain.</p>
                <button class="btn btn-primary" id="configureDnsBtn">Configure DNS</button>
            </div>
        `;
        content.querySelector('#configureDnsBtn').addEventListener('click', () => showConfigureServerDnsModal(content, params));
        return;
    }

    const records = dns.records || [];
    content.innerHTML = `
        <div class="flex flex-col gap-4">
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
                            <div class="font-mono text-sm">${dns.domain}</div>
                        </div>
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Server IP</div>
                            <div class="font-mono text-sm">${dns.serverIp}</div>
                        </div>
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Port</div>
                            <div class="font-mono text-sm">${dns.port || server.port || 25565}</div>
                        </div>
                        <div>
                            <div class="mb-0.5 text-[11px] text-muted-foreground">Provider</div>
                            <div class="text-sm">${dns.providerName || dns.providerId}${dns.providerType ? ` <span class="text-[10px] text-muted-foreground">(${dns.providerType})</span>` : ''}</div>
                        </div>
                    </div>
                </div>
            </div>

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
                                    <span class="rounded-full border border-border px-2 py-0.5 font-mono text-[10px]">${r.type}</span>
                                    <span class="font-mono text-xs">${r.name}</span>
                                </div>
                                <span class="font-mono text-[11px] text-muted-foreground">${r.value}</span>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        </div>
    `;

    content.querySelector('#syncDnsBtn').addEventListener('click', async () => {
        const btn = content.querySelector('#syncDnsBtn');
        btn.disabled = true;
        btn.textContent = 'Syncing...';
        try {
            await api.post(`/dns/servers/${params.id}/sync`);
            showToast('DNS records synced', 'success');
            renderDnsTab(content, params);
        } catch (e) {
            showToast(e.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Sync Records';
        }
    });

    content.querySelector('#removeDnsBtn').addEventListener('click', () => {
        showModal('Remove DNS Configuration', `
            <p class="mb-2">Remove DNS configuration from <strong>${escapeHtml(server.name)}</strong>?</p>
            <p class="text-xs text-muted-foreground">All managed DNS records will be deleted from your provider.</p>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'remove', label: 'Remove DNS', class: 'btn-danger', onClick: async () => {
                try {
                    await api.del(`/dns/servers/${params.id}`);
                    showToast('DNS configuration removed', 'success');
                    renderDnsTab(content, params);
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });
}

async function showConfigureServerDnsModal(content, params) {
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
                ${providers.map(p => `<option value="${p.id}">${p.name} (${p.type})</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Domain</label>
            <input type="text" class="form-input" id="dnsDomain" placeholder="e.g. play.example.com">
            <div class="form-hint">The domain players connect to. A + SRV records will point here at port ${server.port || 25565}.</div>
        </div>
        <div class="form-group">
            <label class="form-label">Server IP</label>
            <input type="text" class="form-input" id="dnsServerIp" placeholder="e.g. 123.45.67.89">
            <div class="form-hint">Public IP address of this machine.</div>
        </div>
        <div class="form-group mb-0">
            <label class="form-label flex cursor-pointer items-center gap-2">
                <input type="checkbox" id="dnsAutoSync" checked class="accent-white">
                Auto-sync DNS records when settings change
            </label>
        </div>
    `, [
        { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
        { id: 'configure', label: 'Configure DNS', class: 'btn-primary', onClick: async () => {
            const data = {
                providerId: document.querySelector('#dnsProvider').value,
                domain: document.querySelector('#dnsDomain').value.trim(),
                serverIp: document.querySelector('#dnsServerIp').value.trim(),
                autoSync: document.querySelector('#dnsAutoSync').checked
            };
            try {
                await api.post(`/dns/servers/${params.id}`, data);
                showToast('DNS configured', 'success');
                renderDnsTab(content, params);
            } catch (e) { showToast(e.message, 'error'); }
        }}
    ]);
}

function updateStatusUI(container) {
    const dot = container.querySelector('#statusDot');
    const label = container.querySelector('#statusLabel');
    if (!dot || !label) return;

    const cls = server.status === 'running' ? 'online' :
                server.status === 'stopped' ? 'offline' : 'starting';
    dot.className = `status-dot ${cls}`;
    label.textContent = server.status.charAt(0).toUpperCase() + server.status.slice(1);

    // Show/hide inline resource stats
    const inline = container.querySelector('#resourceInline');
    if (inline) {
        inline.classList.toggle('hidden', server.status !== 'running');
        inline.classList.toggle('flex', server.status === 'running');
    }

    // Update control buttons in-place (without re-rendering the whole page)
    const controls = container.querySelector('#serverControls');
    if (controls) {
        // Preserve the status badge, replace everything after it
        const badge = controls.querySelector('span');
        controls.innerHTML = '';
        if (badge) controls.appendChild(badge);
        controls.insertAdjacentHTML('beforeend', renderControlButtons());
        wireControlButtons(container, { id: server.id });
    }
}

// Cleanup on page unload
export function destroy() {
    if (consoleComp) {
        consoleComp.destroy();
        consoleComp = null;
    }
    if (statusListener) {
        ws.off('server-status', statusListener);
        statusListener = null;
    }
    if (resourceListener) {
        ws.off('resource-usage', resourceListener);
        resourceListener = null;
    }
    if (resourceAlertListener) {
        ws.off('resource-alert', resourceAlertListener);
        resourceAlertListener = null;
    }
    if (crashListener) {
        ws.off('server-crash', crashListener);
        crashListener = null;
    }
    if (maxCrashesListener) {
        ws.off('server-max-crashes', maxCrashesListener);
        maxCrashesListener = null;
    }
    if (crashCountdownInterval) {
        clearInterval(crashCountdownInterval);
        crashCountdownInterval = null;
    }
    networkInfo = null;
}



