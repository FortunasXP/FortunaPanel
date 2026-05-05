// FortunaPanel - Create Network Wizard
import { api } from '../api.js';
import { app, showToast, escapeHtml } from '../app.js';

export function breadcrumbs() {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Networks', href: '/networks' },
        { label: 'Create Network', href: '/create-network' }
    ];
}

let state = {
    step: 1,
    proxyType: null,
    proxyMode: null, // 'existing' or 'new'
    proxyId: null,
    proxyName: '',
    networkName: '',
    forwardingMode: 'modern',
    backends: [],
    availableServers: [],
    existingProxies: [],
    loading: false
};

export async function render(container) {
    state = { step: 1, proxyType: null, proxyMode: null, proxyId: null, proxyName: '', networkName: '', forwardingMode: 'modern', backends: [], availableServers: [], existingProxies: [], loading: false };
    renderStep(container);
}

function renderStep(container) {
    container.innerHTML = `
        <div class="wizard">
            <div class="page-header">
                <h1 class="page-title">Create Network</h1>
                <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            </div>
            ${renderStepsIndicator()}
            <div class="wizard-content">
                ${state.step === 1 ? renderStep1() : ''}
                ${state.step === 2 ? renderStep2() : ''}
                ${state.step === 3 ? renderStep3() : ''}
                ${state.step === 4 ? renderStep4() : ''}
            </div>
        </div>
    `;
    container.querySelector('#cancelBtn')?.addEventListener('click', () => app.navigate('/networks'));
    wireStep(container);
}

function renderStepsIndicator() {
    const steps = ['Proxy', 'Select Proxy', 'Configure', 'Create'];
    return `<div class="wizard-steps">${steps.map((label, i) => {
        const num = i + 1;
        const cls = num < state.step ? 'completed' : num === state.step ? 'active' : '';
        return `<div class="wizard-step ${cls}"><div class="wizard-step-dot">${num}</div></div>${i < steps.length - 1 ? '<div class="wizard-step-line"></div>' : ''}`;
    }).join('')}</div>`;
}

function renderStep1() {
    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Select Proxy Type</h3>
        <div class="type-grid">
            <div class="type-card ${state.proxyType === 'velocity' ? 'selected' : ''}" data-type="velocity">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>
                <div class="type-card-name">Velocity</div>
                <div class="type-card-desc">Modern, recommended</div>
            </div>
            <div class="type-card ${state.proxyType === 'bungeecord' ? 'selected' : ''}" data-type="bungeecord">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>
                <div class="type-card-name">BungeeCord</div>
                <div class="type-card-desc">Legacy proxy</div>
            </div>
        </div>
        <div class="mt-6 flex justify-end">
            <button class="btn btn-primary" id="nextBtn" ${!state.proxyType ? 'disabled' : ''}>Next</button>
        </div>`;
}

function renderStep2() {
    if (state.loading) {
        return '<div class="page-loading"><div class="spinner"></div></div>';
    }

    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Select Proxy Server</h3>
        ${state.existingProxies.length > 0 ? `
            <div class="mb-4">
                <h4 class="mb-2 text-sm font-medium text-foreground">Existing ${state.proxyType === 'velocity' ? 'Velocity' : 'BungeeCord'} Servers</h4>
                <div class="flex flex-col gap-2">
                    ${state.existingProxies.map(s => `
                        <div class="type-card ${state.proxyId === s.id ? 'selected' : ''} flex-row items-center gap-3" data-proxy-id="${escapeHtml(s.id)}">
                            <span class="status-dot status-${escapeHtml(s.status)}"></span>
                            <div>
                                <div class="font-medium">${escapeHtml(s.name)}</div>
                                <div class="text-xs text-muted-foreground">Port ${escapeHtml(s.port)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : `
            <div class="empty-state-dashed mb-4">
                <div class="empty-state-icon empty-state-icon-sm">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
                        <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
                    </svg>
                </div>
                <div class="mb-1 text-sm font-medium text-foreground">No ${state.proxyType === 'velocity' ? 'Velocity' : 'BungeeCord'} servers available</div>
                <div class="mx-auto max-w-[340px] text-sm text-muted-foreground">You need to create a ${state.proxyType === 'velocity' ? 'Velocity' : 'BungeeCord'} proxy server before you can set up a network. All existing proxy servers may already be linked to other networks.</div>
                <button class="btn btn-primary mt-4 text-xs" id="createProxyBtn">Create Proxy Server</button>
            </div>
        `}
        <div class="mt-6 flex justify-between">
            <button class="btn btn-secondary" id="backBtn">Back</button>
            <button class="btn btn-primary" id="nextBtn" ${!state.proxyId ? 'disabled' : ''}>Next</button>
        </div>`;
}

function renderStep3() {
    const fwdOptions = state.proxyType === 'velocity'
        ? ['modern', 'legacy', 'bunguard', 'none']
        : ['ip_forward'];

    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Configure Network</h3>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="form-group">
                <label class="form-label">Network Name</label>
                <input type="text" class="form-input" id="networkName" value="${escapeHtml(state.networkName)}" placeholder="My Network">
            </div>
            <div class="form-group">
                <label class="form-label">Forwarding Mode</label>
                <select class="form-select" id="forwardingMode">
                    ${fwdOptions.map(m => `<option value="${m}" ${m === state.forwardingMode ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
                <div class="form-hint">${state.proxyType === 'velocity' ? 'Modern forwarding is recommended.' : 'BungeeCord uses IP forwarding.'}</div>
            </div>
        </div>

        <h4 class="mb-2 mt-6 text-sm font-medium text-foreground">Add Backend Servers (optional)</h4>
        <div class="mb-3 text-xs text-muted-foreground">You can add backends now or later from the network detail page.</div>

        ${state.availableServers.length > 0 ? `
            <div class="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto">
                ${state.availableServers.map(s => `
                    <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                        <input type="checkbox" value="${escapeHtml(s.id)}" class="backend-check" ${state.backends.find(b => b.id === s.id) ? 'checked' : ''}>
                        <span>${escapeHtml(s.name)} (${escapeHtml(s.type)}, port ${escapeHtml(s.port)})</span>
                    </label>
                `).join('')}
            </div>
        ` : '<div class="text-sm text-muted-foreground">No available backend servers.</div>'}

        <div class="mt-6 flex justify-between">
            <button class="btn btn-secondary" id="backBtn">Back</button>
            <button class="btn btn-primary" id="nextBtn">Review & Create</button>
        </div>`;
}

function renderStep4() {
    const proxy = state.existingProxies.find(p => p.id === state.proxyId);

    return `
        <h3 class="mb-4 text-base font-medium text-foreground">Review & Create</h3>
        <div class="settings-card mb-5">
            <div class="settings-card-body">
                <div class="grid grid-cols-[140px_1fr] gap-2 text-sm">
                    <span class="text-muted-foreground">Network Name</span><span>${escapeHtml(state.networkName || 'Unnamed')}</span>
                    <span class="text-muted-foreground">Proxy Type</span><span>${escapeHtml(state.proxyType)}</span>
                    <span class="text-muted-foreground">Proxy Server</span><span>${escapeHtml(proxy?.name || 'Unknown')} (port ${escapeHtml(proxy?.port || '?')})</span>
                    <span class="text-muted-foreground">Forwarding Mode</span><span>${escapeHtml(state.forwardingMode)}</span>
                    <span class="text-muted-foreground">Backend Servers</span><span>${state.backends.length > 0 ? state.backends.map(b => escapeHtml(b.name)).join(', ') : 'None (add later)'}</span>
                </div>
            </div>
        </div>
        <div id="createProgress" class="mb-5 hidden">
            <div class="mb-2 text-sm text-muted-foreground" id="progressText">Creating network...</div>
            <div class="progress-bar"><div class="progress-bar-fill" id="progressFill" style="width:0%"></div></div>
        </div>
        <div class="flex justify-between">
            <button class="btn btn-secondary" id="backBtn">Back</button>
            <button class="btn btn-primary" id="createBtn">Create Network</button>
        </div>`;
}

function wireStep(container) {
    // Type card selection
    container.querySelectorAll('.type-card[data-type]').forEach(card => {
        card.addEventListener('click', () => {
            state.proxyType = card.dataset.type;
            state.forwardingMode = state.proxyType === 'velocity' ? 'modern' : 'ip_forward';
            renderStep(container);
        });
    });

    // Create proxy CTA button
    container.querySelector('#createProxyBtn')?.addEventListener('click', () => app.navigate('/create'));

    // Proxy selection
    container.querySelectorAll('.type-card[data-proxy-id]').forEach(card => {
        card.addEventListener('click', () => {
            state.proxyId = card.dataset.proxyId;
            const proxy = state.existingProxies.find(p => p.id === state.proxyId);
            state.proxyName = proxy?.name || '';
            if (!state.networkName) state.networkName = `${state.proxyName} Network`;
            renderStep(container);
        });
    });

    // Next button
    container.querySelector('#nextBtn')?.addEventListener('click', async () => {
        if (state.step === 1 && state.proxyType) {
            state.step = 2;
            state.loading = true;
            renderStep(container);

            try {
                const servers = await api.get('/servers');
                const networks = await api.get('/networks');
                const linkedIds = new Set();
                for (const n of networks) {
                    linkedIds.add(n.proxyId);
                    for (const bid of (n.backendIds || [])) linkedIds.add(bid);
                }

                state.existingProxies = servers.filter(s =>
                    s.type === state.proxyType && !linkedIds.has(s.id)
                );
                state.availableServers = servers.filter(s =>
                    !['velocity', 'bungeecord'].includes(s.type) && !linkedIds.has(s.id)
                );
            } catch (err) {
                showToast('Failed to load servers: ' + err.message, 'error');
            }

            state.loading = false;
            renderStep(container);
        } else if (state.step === 2 && state.proxyId) {
            state.step = 3;
            renderStep(container);
        } else if (state.step === 3) {
            state.networkName = container.querySelector('#networkName')?.value || state.networkName;
            state.forwardingMode = container.querySelector('#forwardingMode')?.value || state.forwardingMode;

            // Gather checked backends
            state.backends = [];
            container.querySelectorAll('.backend-check:checked').forEach(cb => {
                const s = state.availableServers.find(sv => sv.id === cb.value);
                if (s) state.backends.push(s);
            });

            state.step = 4;
            renderStep(container);
        }
    });

    // Back button
    container.querySelector('#backBtn')?.addEventListener('click', () => {
        state.step--;
        renderStep(container);
    });

    // Create button
    container.querySelector('#createBtn')?.addEventListener('click', () => createNetwork(container));
}

async function createNetwork(container) {
    const createBtn = container.querySelector('#createBtn');
    const progress = container.querySelector('#createProgress');
    const progressText = container.querySelector('#progressText');
    const progressFill = container.querySelector('#progressFill');

    createBtn.disabled = true;
    progress.classList.remove('hidden');

    try {
        progressText.textContent = 'Creating network...';
        progressFill.style.width = '25%';

        const network = await api.post('/networks', {
            name: state.networkName,
            proxyId: state.proxyId,
            proxyType: state.proxyType
        });

        // Add backends
        if (state.backends.length > 0) {
            progressText.textContent = 'Adding backend servers...';
            for (let i = 0; i < state.backends.length; i++) {
                const b = state.backends[i];
                progressFill.style.width = `${25 + (75 * (i + 1) / state.backends.length)}%`;
                progressText.textContent = `Adding ${b.name}...`;
                const alias = b.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                await api.post(`/networks/${network.id}/backends`, { serverId: b.id, alias });
            }
        }

        progressFill.style.width = '100%';
        progressText.textContent = 'Network created!';
        showToast(`Network "${state.networkName}" created successfully`, 'success');

        setTimeout(() => app.navigate(`/network/${network.id}`), 500);
    } catch (err) {
        showToast('Failed to create network: ' + err.message, 'error');
        createBtn.disabled = false;
        progress.classList.add('hidden');
    }
}

export function destroy() {
    state = { step: 1, proxyType: null, proxyMode: null, proxyId: null, proxyName: '', networkName: '', forwardingMode: 'modern', backends: [], availableServers: [], existingProxies: [], loading: false };
}
