// FortunaPanel - Create Server Wizard
import { api } from '../api.js';
import { app, showToast, escapeHtml } from '../app.js';

const PROXY_TYPES = ['velocity', 'bungeecord'];
function isProxy() {
    if (state.type === 'template' && state.selectedTemplate) {
        return PROXY_TYPES.includes(state.selectedTemplate.config.type);
    }
    if (state.type === 'archive' && state.archiveUpload) {
        return PROXY_TYPES.includes(state.archiveUpload.detected.type);
    }
    return PROXY_TYPES.includes(state.type);
}

function formatBytes(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function breadcrumbs() {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Create Server', href: '/create' }
    ];
}

let state = {
    step: 1,
    type: null,
    version: null,
    build: null,
    name: '',
    port: 25565,
    memoryMin: '1G',
    memoryMax: '2G',
    gamemode: 'survival',
    difficulty: 'normal',
    maxPlayers: 20,
    motd: 'A FortunaPanel Server',
    jvmArgs: '',
    versions: [],
    builds: [],
    loading: false,
    customFile: null,
    archiveFile: null,
    archiveUploading: false,
    archiveUpload: null,  // { directory, detected }
    templates: [],
    selectedTemplate: null
};

export async function render(container) {
    state = {
        ...state,
        step: 1, type: null, version: null, build: null, loading: false,
        customFile: null, archiveFile: null, archiveUploading: false, archiveUpload: null,
        name: '', templates: [], selectedTemplate: null
    };
    renderStep(container);
}

function renderStep(container) {
    container.innerHTML = `
        <div class="wizard">
            <div class="page-header">
                <h1 class="page-title">Create Server</h1>
                <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            </div>
            ${renderStepsIndicator()}
            <div class="wizard-content" id="wizardContent">
                ${state.step === 1 ? renderStep1() : ''}
                ${state.step === 2 ? renderStep2() : ''}
                ${state.step === 3 ? renderStep3() : ''}
                ${state.step === 4 ? renderStep4() : ''}
            </div>
        </div>
    `;
    container.querySelector('#cancelBtn')?.addEventListener('click', () => app.navigate('/'));
    wireStep(container);
}

function renderStepsIndicator() {
    const steps = ['Type', 'Version', 'Configure', 'Create'];
    return `<div class="wizard-steps">${steps.map((label, i) => {
        const num = i + 1;
        const cls = num < state.step ? 'completed' : num === state.step ? 'active' : '';
        return `<div class="wizard-step ${cls}"><div class="wizard-step-dot">${num}</div></div>${i < steps.length - 1 ? '<div class="wizard-step-line"></div>' : ''}`;
    }).join('')}</div>`;
}

function renderStep1() {
    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Select Server Type</h3>
        <div class="type-grid">
            <div class="type-card ${state.type === 'paper' ? 'selected' : ''}" data-type="paper">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div class="type-card-name">Paper</div>
                <div class="type-card-desc">High performance fork</div>
            </div>
            <div class="type-card ${state.type === 'vanilla' ? 'selected' : ''}" data-type="vanilla">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 12h10M12 7v10"/></svg>
                <div class="type-card-name">Vanilla</div>
                <div class="type-card-desc">Official Mojang server</div>
            </div>
            <div class="type-card ${state.type === 'velocity' ? 'selected' : ''}" data-type="velocity">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>
                <div class="type-card-name">Velocity</div>
                <div class="type-card-desc">Modern proxy server</div>
            </div>
            <div class="type-card ${state.type === 'bungeecord' ? 'selected' : ''}" data-type="bungeecord">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>
                <div class="type-card-name">BungeeCord</div>
                <div class="type-card-desc">Legacy proxy server</div>
            </div>
            <div class="type-card ${state.type === 'custom' ? 'selected' : ''}" data-type="custom">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div class="type-card-name">Custom JAR</div>
                <div class="type-card-desc">Upload your own</div>
            </div>
            <div class="type-card ${state.type === 'archive' ? 'selected' : ''}" data-type="archive">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                <div class="type-card-name">Server Archive</div>
                <div class="type-card-desc">Upload a full server ZIP</div>
            </div>
            <div class="type-card ${state.type === 'template' ? 'selected' : ''}" data-type="template">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                <div class="type-card-name">Template</div>
                <div class="type-card-desc">From saved template</div>
            </div>
        </div>
        <div class="mt-6 flex justify-end">
            <button class="btn btn-primary" id="nextBtn" ${!state.type ? 'disabled' : ''}>Next</button>
        </div>`;
}

function renderStep2() {
    if (state.type === 'template') {
        if (state.loading) {
            return `<div class="page-loading"><div class="spinner"></div></div>`;
        }
        if (state.templates.length === 0) {
            return `
                <h3 class="mb-4 text-base font-medium text-foreground">Select Template</h3>
                <div class="empty-state p-10">
                    <h3>No templates saved</h3>
                    <p>Save a server as a template from its Settings tab first.</p>
                </div>
                <div class="mt-6 flex justify-start">
                    <button class="btn btn-secondary" id="backBtn">Back</button>
                </div>`;
        }
        return `
            <h3 class="mb-4 text-base font-medium text-foreground">Select Template</h3>
            <div class="form-group">
                <label class="form-label">Template</label>
                <select class="form-select" id="templateSelect">
                    <option value="">Select a template...</option>
                    ${state.templates.map(t => `<option value="${escapeHtml(t.id)}" ${state.selectedTemplate?.id === t.id ? 'selected' : ''}>${escapeHtml(t.name)} — ${escapeHtml(t.config.type)} ${escapeHtml(t.config.version || '')}</option>`).join('')}
                </select>
            </div>
            ${state.selectedTemplate ? `
                <div class="settings-card mt-3">
                    <div class="settings-card-body px-4 py-3.5">
                        <div class="grid grid-cols-[100px_1fr] gap-1.5 text-xs">
                            <span class="text-muted-foreground">Type</span><span>${escapeHtml(state.selectedTemplate.config.type)}</span>
                            <span class="text-muted-foreground">Version</span><span>${escapeHtml(state.selectedTemplate.config.version || '—')}</span>
                            <span class="text-muted-foreground">Memory</span><span>${escapeHtml(state.selectedTemplate.config.memory?.min || '1G')} — ${escapeHtml(state.selectedTemplate.config.memory?.max || '2G')}</span>
                            <span class="text-muted-foreground">Max Players</span><span>${state.selectedTemplate.config.maxPlayers || 20}</span>
                            <span class="text-muted-foreground">Source</span><span>${escapeHtml(state.selectedTemplate.sourceServer)}</span>
                        </div>
                    </div>
                </div>
            ` : ''}
            <div class="mt-6 flex justify-between">
                <button class="btn btn-secondary" id="backBtn">Back</button>
                <button class="btn btn-primary" id="nextBtn" ${!state.selectedTemplate ? 'disabled' : ''}>Next</button>
            </div>`;
    }
    if (state.type === 'custom') {
        return `
            <h3 class="mb-4 text-base font-medium text-foreground">Upload Custom JAR</h3>
            <div class="form-group">
                <label class="form-label">Server JAR File</label>
                <label class="file-drop ${state.customFile ? 'has-file' : ''}" for="jarUpload">
                    <input type="file" id="jarUpload" accept=".jar" class="sr-only">
                    ${state.customFile ? `
                        <div class="file-drop-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <div class="file-drop-body">
                            <div class="file-drop-title">${escapeHtml(state.customFile.name)}</div>
                            <div class="file-drop-meta">${formatBytes(state.customFile.size)} · click to replace</div>
                        </div>
                    ` : `
                        <div class="file-drop-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        </div>
                        <div class="file-drop-body">
                            <div class="file-drop-title">Choose a .jar file</div>
                            <div class="file-drop-meta">or drag and drop · max 200 MB</div>
                        </div>
                    `}
                </label>
            </div>
            <div class="mt-6 flex justify-between">
                <button class="btn btn-secondary" id="backBtn">Back</button>
                <button class="btn btn-primary" id="nextBtn" ${!state.customFile ? 'disabled' : ''}>Next</button>
            </div>`;
    }
    if (state.type === 'archive') {
        const u = state.archiveUpload;
        const badgeForType = (t) => {
            const colors = {
                paper: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                purpur: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
                spigot: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                vanilla: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
                velocity: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
                bungeecord: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
                fabric: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
                forge: 'bg-red-500/15 text-red-400 border-red-500/30',
                custom: 'bg-muted text-muted-foreground border-border'
            };
            return colors[t] || colors.custom;
        };
        return `
            <h3 class="mb-2 text-base font-medium text-foreground">Upload Server Archive</h3>
            <p class="mb-4 text-xs text-muted-foreground">Zip your existing server folder (the one containing the JAR, <code class="text-[11px]">server.properties</code>, world data, plugins, etc.) and upload it here. We'll detect the type and entry JAR automatically.</p>
            <div class="form-group">
                <label class="form-label">Server ZIP</label>
                <label class="file-drop ${state.archiveFile ? 'has-file' : ''} ${state.archiveUploading ? 'is-uploading' : ''}" for="zipUpload">
                    <input type="file" id="zipUpload" accept=".zip" class="sr-only" ${state.archiveUploading ? 'disabled' : ''}>
                    ${state.archiveUploading ? `
                        <div class="file-drop-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                        </div>
                        <div class="file-drop-body">
                            <div class="file-drop-title">Extracting ${escapeHtml(state.archiveFile?.name || 'archive')}...</div>
                            <div class="file-drop-meta">Scanning for server files</div>
                        </div>
                    ` : state.archiveFile ? `
                        <div class="file-drop-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                        </div>
                        <div class="file-drop-body">
                            <div class="file-drop-title">${escapeHtml(state.archiveFile.name)}</div>
                            <div class="file-drop-meta">${formatBytes(state.archiveFile.size)} · click to replace</div>
                        </div>
                    ` : `
                        <div class="file-drop-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        </div>
                        <div class="file-drop-body">
                            <div class="file-drop-title">Choose a .zip archive</div>
                            <div class="file-drop-meta">or drag and drop · max 1 GB</div>
                        </div>
                    `}
                </label>
            </div>
            ${u ? `
                <div class="settings-card mt-2">
                    <div class="settings-card-body px-4 py-3.5">
                        <div class="mb-2 flex items-center gap-2">
                            <span class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeForType(u.detected.type)}">${escapeHtml(u.detected.type)}</span>
                            <span class="text-xs text-muted-foreground">Detected from archive</span>
                        </div>
                        <div class="grid grid-cols-[120px_1fr] gap-1.5 text-xs">
                            <span class="text-muted-foreground">Entry JAR</span><span class="font-mono text-[11px]">${escapeHtml(u.detected.jarFile)}</span>
                            ${u.detected.version ? `<span class="text-muted-foreground">Version</span><span>${escapeHtml(u.detected.version)}</span>` : ''}
                            ${!u.detected.isProxy && u.detected.port ? `<span class="text-muted-foreground">Port</span><span class="font-mono text-[11px]">${u.detected.port}</span>` : ''}
                            ${!u.detected.isProxy && u.detected.maxPlayers ? `<span class="text-muted-foreground">Max Players</span><span>${u.detected.maxPlayers}</span>` : ''}
                        </div>
                    </div>
                </div>
            ` : ''}
            <div class="mt-6 flex justify-between">
                <button class="btn btn-secondary" id="backBtn" ${state.archiveUploading ? 'disabled' : ''}>Back</button>
                <button class="btn btn-primary" id="nextBtn" ${!u || state.archiveUploading ? 'disabled' : ''}>Next</button>
            </div>`;
    }

    // paper | vanilla | velocity | bungeecord — remote version pickers
    const showBuilds = (state.type === 'paper' || state.type === 'velocity') && state.builds.length > 0;
    const versionLabel = state.type === 'bungeecord' ? 'Build' : 'Version';
    const typeLabel = state.type === 'paper' ? 'Paper'
        : state.type === 'vanilla' ? 'Vanilla'
        : state.type === 'velocity' ? 'Velocity'
        : state.type === 'bungeecord' ? 'BungeeCord'
        : state.type;
    const versionCount = state.versions.length;

    return `
        <div class="mb-4 flex items-center justify-between">
            <h3 class="text-base font-medium text-foreground">Select ${versionLabel}</h3>
            ${!state.loading && versionCount > 0 ? `<span class="text-xs text-muted-foreground">${versionCount} ${versionLabel.toLowerCase()}${versionCount !== 1 ? 's' : ''} available</span>` : ''}
        </div>
        ${state.loading ? `
            <div class="flex items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/30 px-6 py-10">
                <div class="spinner"></div>
                <div class="text-sm text-muted-foreground">Fetching ${typeLabel} ${versionLabel.toLowerCase()}s…</div>
            </div>
        ` : versionCount === 0 ? `
            <div class="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
                <h3 class="text-sm font-semibold text-destructive">Couldn't load ${versionLabel.toLowerCase()}s</h3>
                <p class="mt-1 text-xs text-muted-foreground">The upstream API may be unreachable. Try again in a moment.</p>
            </div>
        ` : `
            <div class="form-group">
                <label class="form-label" for="versionSelect">${isProxy() ? 'Proxy' : 'Minecraft'} ${versionLabel}</label>
                <div class="relative">
                    <select class="form-select pr-10" id="versionSelect">
                        <option value="">Select ${versionLabel.toLowerCase()}…</option>
                        ${state.versions.map((v, i) => {
                            const latest = i === 0 ? ' (latest)' : '';
                            return `<option value="${escapeHtml(v)}" ${v === state.version ? 'selected' : ''}>${escapeHtml(v)}${latest}</option>`;
                        }).join('')}
                    </select>
                </div>
                <div class="form-hint">${typeLabel} ${versionLabel.toLowerCase()}s are fetched live from the official repository.</div>
            </div>
            ${showBuilds ? `
                <div class="form-group">
                    <label class="form-label" for="buildSelect">Build</label>
                    <select class="form-select pr-10" id="buildSelect">
                        ${state.builds.map((b, i) => `<option value="${b.build}" ${b.build === state.build ? 'selected' : ''}>#${b.build} (${escapeHtml(b.channel)})${i === 0 ? ' · latest' : ''}</option>`).join('')}
                    </select>
                    <div class="form-hint">The latest stable build is selected by default.</div>
                </div>
            ` : ''}
        `}
        <div class="mt-6 flex justify-between">
            <button class="btn btn-secondary" id="backBtn">Back</button>
            <button class="btn btn-primary" id="nextBtn" ${!state.version || state.loading ? 'disabled' : ''}>Next</button>
        </div>`;
}

function renderStep3() {
    const proxy = isProxy();
    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Configure ${proxy ? 'Proxy' : 'Server'}</h3>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="form-group">
                <label class="form-label">${proxy ? 'Proxy' : 'Server'} Name</label>
                <input type="text" class="form-input" id="serverName" value="${escapeHtml(state.name)}" placeholder="${proxy ? 'My Proxy' : 'My Server'}">
            </div>
            <div class="form-group">
                <label class="form-label">${proxy ? 'Bind Port' : 'Port'}</label>
                <input type="number" class="form-input" id="serverPort" value="${state.port}" min="1" max="65535">
                <div class="form-hint" id="portHint">Auto-assigned next available port</div>
            </div>
            <div class="form-group">
                <label class="form-label">Min Memory</label>
                <select class="form-select" id="memMin">
                    ${['512M','1G','2G','3G','4G'].map(v => `<option value="${v}" ${v === state.memoryMin ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Max Memory</label>
                <select class="form-select" id="memMax">
                    ${['1G','2G','3G','4G','6G','8G','12G','16G'].map(v => `<option value="${v}" ${v === state.memoryMax ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            ${!proxy ? `
            <div class="form-group">
                <label class="form-label">Gamemode</label>
                <select class="form-select" id="gamemode">
                    ${['survival','creative','adventure','spectator'].map(v => `<option value="${v}" ${v === state.gamemode ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Difficulty</label>
                <select class="form-select" id="difficulty">
                    ${['peaceful','easy','normal','hard'].map(v => `<option value="${v}" ${v === state.difficulty ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Max Players</label>
                <input type="number" class="form-input" id="maxPlayers" value="${state.maxPlayers}" min="1" max="999">
            </div>
            <div class="form-group">
                <label class="form-label">MOTD</label>
                <input type="text" class="form-input" id="motd" value="${escapeHtml(state.motd)}" maxlength="59">
            </div>` : ''}
        </div>
        <div class="form-group mt-2">
            <label class="form-label">Custom JVM Arguments</label>
            <input type="text" class="form-input" id="jvmArgs" value="${escapeHtml(state.jvmArgs)}" placeholder="-XX:+UseG1GC -Dfml.readTimeout=180">
            <div class="form-hint">Space-separated JVM flags</div>
        </div>
        <div class="mt-6 flex justify-between">
            <button class="btn btn-secondary" id="backBtn">Back</button>
            <button class="btn btn-primary" id="nextBtn">Review & Create</button>
        </div>`;
}

function renderStep4() {
    const proxy = isProxy();
    const displayVersion = state.type === 'archive' && state.archiveUpload
        ? (state.archiveUpload.detected.version || 'archive')
        : (state.version || 'custom');
    const displayType = state.type === 'archive' && state.archiveUpload
        ? `archive (${state.archiveUpload.detected.type})`
        : state.type;
    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Review & Create</h3>
        <div class="settings-card mb-5">
            <div class="settings-card-body">
                <div class="grid grid-cols-[120px_1fr] gap-2 text-sm">
                    <span class="text-muted-foreground">Type</span><span>${escapeHtml(displayType)}</span>
                    <span class="text-muted-foreground">Version</span><span>${escapeHtml(displayVersion)}</span>
                    ${state.build ? `<span class="text-muted-foreground">Build</span><span>#${state.build}</span>` : ''}
                    <span class="text-muted-foreground">Name</span><span>${escapeHtml(state.name || 'Unnamed')}</span>
                    <span class="text-muted-foreground">${proxy ? 'Bind Port' : 'Port'}</span><span>${state.port}</span>
                    <span class="text-muted-foreground">Memory</span><span>${escapeHtml(state.memoryMin)} - ${escapeHtml(state.memoryMax)}</span>
                    ${!proxy ? `
                    <span class="text-muted-foreground">Gamemode</span><span>${escapeHtml(state.gamemode)}</span>
                    <span class="text-muted-foreground">Difficulty</span><span>${escapeHtml(state.difficulty)}</span>
                    <span class="text-muted-foreground">Max Players</span><span>${state.maxPlayers}</span>` : ''}
                    ${state.jvmArgs ? `<span class="text-muted-foreground">JVM Args</span><span class="font-mono text-xs">${escapeHtml(state.jvmArgs)}</span>` : ''}
                </div>
            </div>
        </div>
        <div id="createProgress" class="mb-5 hidden">
            <div class="mb-2 text-sm text-muted-foreground" id="progressText">Downloading JAR...</div>
            <div class="progress-bar"><div class="progress-bar-fill" id="progressFill" style="width:0%"></div></div>
        </div>
        <div class="flex justify-between">
            <button class="btn btn-secondary" id="backBtn">Back</button>
            <button class="btn btn-primary" id="createBtn">Create ${proxy ? 'Proxy' : 'Server'}</button>
        </div>`;
}

function wireStep(container) {
    // Type card selection
    container.querySelectorAll('.type-card').forEach(card => {
        card.addEventListener('click', () => {
            state.type = card.dataset.type;
            renderStep(container);
        });
    });

    // Template select
    container.querySelector('#templateSelect')?.addEventListener('change', (e) => {
        state.selectedTemplate = state.templates.find(t => t.id === e.target.value) || null;
        renderStep(container);
    });

    // Next button
    container.querySelector('#nextBtn')?.addEventListener('click', async () => {
        if (state.step === 1 && state.type) {
            state.step = 2;
            if (state.type === 'template') {
                state.loading = true;
                renderStep(container);
                try {
                    state.templates = await api.get('/templates');
                } catch (err) {
                    showToast('Failed to load templates: ' + err.message, 'error');
                    state.templates = [];
                }
                state.loading = false;
            } else if (state.type !== 'custom' && state.type !== 'archive') {
                state.loading = true;
                renderStep(container);
                try {
                    const data = await api.get(`/jars/versions?type=${state.type}`);
                    state.versions = data.versions;
                    if (state.versions.length > 0) {
                        state.version = state.versions[0];
                        if (state.type === 'paper' || state.type === 'velocity') await loadBuilds();
                    }
                } catch (err) {
                    showToast('Failed to load versions: ' + err.message, 'error');
                }
                state.loading = false;
            }
            renderStep(container);
        } else if (state.step === 2) {
            if (state.type === 'template' && state.selectedTemplate) {
                const tc = state.selectedTemplate.config;
                if (!state.name) state.name = `${state.selectedTemplate.name}`;
                state.memoryMin = tc.memory?.min || '1G';
                state.memoryMax = tc.memory?.max || '2G';
                state.maxPlayers = tc.maxPlayers || 20;
                state.gamemode = tc.gamemode || 'survival';
                state.difficulty = tc.difficulty || 'normal';
                state.motd = tc.motd || '';
                state.jvmArgs = (tc.jvmArgs || []).join(' ');
                state.version = tc.version || 'template';
            }
            if (state.type === 'archive' && state.archiveUpload) {
                const d = state.archiveUpload.detected;
                if (!state.name) state.name = state.archiveFile?.name?.replace(/\.zip$/i, '') || 'imported-server';
                if (d.maxPlayers) state.maxPlayers = d.maxPlayers;
                if (d.motd) state.motd = d.motd;
                state.version = d.version || 'archive';
            }
            if (!state.name) state.name = `${state.type}-${state.version || 'server'}`;
            // Auto-assign port from port manager (unless archive brought a usable one)
            try {
                const ports = await api.get('/servers/ports/overview');
                if (state.type === 'archive' && state.archiveUpload?.detected?.port
                        && !ports.usedPorts.includes(state.archiveUpload.detected.port)) {
                    state.port = state.archiveUpload.detected.port;
                } else {
                    state.port = ports.nextAvailable;
                }
            } catch (e) {}
            state.step = 3;
            renderStep(container);
        } else if (state.step === 3) {
            state.name = container.querySelector('#serverName')?.value || state.name;
            state.port = parseInt(container.querySelector('#serverPort')?.value) || 25565;
            state.memoryMin = container.querySelector('#memMin')?.value || '1G';
            state.memoryMax = container.querySelector('#memMax')?.value || '2G';
            if (!isProxy()) {
                state.gamemode = container.querySelector('#gamemode')?.value || 'survival';
                state.difficulty = container.querySelector('#difficulty')?.value || 'normal';
                state.maxPlayers = parseInt(container.querySelector('#maxPlayers')?.value) || 20;
                state.motd = container.querySelector('#motd')?.value || '';
            }
            state.jvmArgs = container.querySelector('#jvmArgs')?.value || '';
            state.step = 4;
            renderStep(container);
        }
    });

    // Back button
    container.querySelector('#backBtn')?.addEventListener('click', () => {
        state.step--;
        renderStep(container);
    });

    // Version select
    container.querySelector('#versionSelect')?.addEventListener('change', async (e) => {
        state.version = e.target.value;
        if ((state.type === 'paper' || state.type === 'velocity') && state.version) {
            await loadBuilds();
            renderStep(container);
        }
        const nextBtn = container.querySelector('#nextBtn');
        if (nextBtn) nextBtn.disabled = !state.version;
    });

    // Build select
    container.querySelector('#buildSelect')?.addEventListener('change', (e) => {
        state.build = parseInt(e.target.value);
    });

    // Custom JAR upload
    container.querySelector('#jarUpload')?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            state.customFile = e.target.files[0];
            state.version = 'custom';
            renderStep(container);
        }
    });

    // Server archive (ZIP) upload
    container.querySelector('#zipUpload')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.zip')) {
            showToast('Please select a .zip archive', 'error');
            return;
        }
        state.archiveFile = file;
        state.archiveUpload = null;
        state.archiveUploading = true;
        renderStep(container);
        try {
            const result = await api.upload('/jars/upload-zip', file);
            state.archiveUpload = { directory: result.directory, detected: result.detected };
            showToast(`Detected ${result.detected.type} server (${result.detected.jarFile})`, 'success');
        } catch (err) {
            state.archiveFile = null;
            state.archiveUpload = null;
            showToast('Upload failed: ' + err.message, 'error');
        }
        state.archiveUploading = false;
        renderStep(container);
    });

    // Wire drag-and-drop on any visible file-drop target
    container.querySelectorAll('.file-drop').forEach(dropEl => {
        const input = dropEl.querySelector('input[type="file"]');
        if (!input) return;
        ['dragenter', 'dragover'].forEach(evt => dropEl.addEventListener(evt, (e) => {
            e.preventDefault();
            dropEl.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(evt => dropEl.addEventListener(evt, (e) => {
            e.preventDefault();
            dropEl.classList.remove('dragover');
        }));
        dropEl.addEventListener('drop', (e) => {
            if (!e.dataTransfer?.files?.length) return;
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    // Create button
    container.querySelector('#createBtn')?.addEventListener('click', () => createServer(container));
}

async function loadBuilds() {
    try {
        const data = await api.get(`/jars/builds?type=${state.type}&version=${state.version}`);
        state.builds = data.builds.reverse();
        if (state.builds.length > 0) state.build = state.builds[0].build;
    } catch (err) {
        showToast('Failed to load builds', 'error');
    }
}

async function createServer(container) {
    const createBtn = container.querySelector('#createBtn');
    const progress = container.querySelector('#createProgress');
    const progressText = container.querySelector('#progressText');
    const progressFill = container.querySelector('#progressFill');

    createBtn.disabled = true;
    progress.classList.remove('hidden');

    try {
        // Template-based creation
        if (state.type === 'template' && state.selectedTemplate) {
            progressText.textContent = 'Creating server from template...';
            progressFill.style.width = '50%';

            const server = await api.post(`/templates/${state.selectedTemplate.id}/create`, {
                name: state.name,
                port: state.port,
                memory: { min: state.memoryMin, max: state.memoryMax }
            });

            progressFill.style.width = '100%';
            progressText.textContent = 'Server created!';
            showToast(`Server "${state.name}" created from template`, 'success');
            setTimeout(() => app.navigate(`/server/${server.id}`), 500);
            return;
        }

        // Archive-based creation — zip was already uploaded + extracted in step 2
        if (state.type === 'archive' && state.archiveUpload) {
            progressText.textContent = 'Creating server from archive...';
            progressFill.style.width = '60%';

            const d = state.archiveUpload.detected;
            const jvmArgs = state.jvmArgs ? state.jvmArgs.split(/\s+/).filter(Boolean) : [];
            const body = {
                name: state.name,
                type: d.type,
                version: d.version || 'archive',
                port: state.port,
                memory: { min: state.memoryMin, max: state.memoryMax },
                jvmArgs,
                sourceDirectory: state.archiveUpload.directory,
                jarFile: d.jarFile
            };
            if (!isProxy()) {
                body.gamemode = state.gamemode;
                body.difficulty = state.difficulty;
                body.maxPlayers = state.maxPlayers;
                body.motd = state.motd;
            }

            const server = await api.post('/servers', body);
            progressFill.style.width = '100%';
            progressText.textContent = 'Server created!';
            showToast(`Server "${state.name}" created from archive`, 'success');
            setTimeout(() => app.navigate(`/server/${server.id}`), 500);
            return;
        }

        let jarResult;
        if (state.type === 'custom' && state.customFile) {
            progressText.textContent = 'Uploading JAR...';
            jarResult = await api.upload('/jars/upload', state.customFile);
        } else {
            progressText.textContent = `Downloading ${isProxy() ? 'proxy' : 'server'} JAR...`;
            jarResult = await api.post('/jars/download', {
                type: state.type,
                version: state.version,
                build: state.build
            });
        }

        progressFill.style.width = '50%';
        progressText.textContent = `Creating ${isProxy() ? 'proxy' : 'server'}...`;

        const jvmArgs = state.jvmArgs ? state.jvmArgs.split(/\s+/).filter(Boolean) : [];
        const body = {
            name: state.name,
            type: state.type,
            version: state.version,
            port: state.port,
            memory: { min: state.memoryMin, max: state.memoryMax },
            jvmArgs,
            jarPath: jarResult.path
        };

        if (!isProxy()) {
            body.gamemode = state.gamemode;
            body.difficulty = state.difficulty;
            body.maxPlayers = state.maxPlayers;
            body.motd = state.motd;
        }

        const server = await api.post('/servers', body);

        progressFill.style.width = '100%';
        progressText.textContent = `${isProxy() ? 'Proxy' : 'Server'} created!`;
        showToast(`${isProxy() ? 'Proxy' : 'Server'} "${state.name}" created successfully`, 'success');

        setTimeout(() => app.navigate(`/server/${server.id}`), 500);
    } catch (err) {
        showToast('Failed to create: ' + err.message, 'error');
        createBtn.disabled = false;
        progress.classList.add('hidden');
    }
}

export function destroy() {
    state = { step: 1, type: null, version: null, build: null, name: '', port: 25565, memoryMin: '1G', memoryMax: '2G', gamemode: 'survival', difficulty: 'normal', maxPlayers: 20, motd: 'A FortunaPanel Server', jvmArgs: '', versions: [], builds: [] };
}
