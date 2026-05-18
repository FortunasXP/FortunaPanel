// FortunaPanel - Scheduled Tasks Page
import { api } from '../api.js';
import { showToast, showModal, escapeHtml } from '../app.js';

export function breadcrumbs() {
    return [{ label: 'Scheduled Tasks', href: '/schedule' }];
}

export async function render(container) {
    let tasks = [];
    let servers = [];
    let networks = [];

    // Settle each request independently so one slow/failing endpoint
    // doesn't leave the others undefined. Previously a bare Promise.all
    // + bare destructure would either crash on a null response or
    // silently leave us rendering an empty page with no feedback.
    const [scheduleRes, serversRes, networksRes] = await Promise.allSettled([
        api.get('/schedule'),
        api.get('/servers'),
        api.get('/networks')
    ]);
    if (scheduleRes.status === 'fulfilled' && scheduleRes.value && Array.isArray(scheduleRes.value.tasks)) {
        tasks = scheduleRes.value.tasks;
    }
    if (serversRes.status === 'fulfilled' && Array.isArray(serversRes.value)) {
        servers = serversRes.value;
    }
    if (networksRes.status === 'fulfilled' && Array.isArray(networksRes.value)) {
        networks = networksRes.value;
    }

    const networkTypeLabels = {
        network_start: 'Network Start',
        network_stop: 'Network Stop',
        network_restart: 'Network Restart',
        rolling_restart: 'Rolling Restart'
    };
    const serverTypeLabels = {
        restart: 'Auto Restart',
        backup: 'Auto Backup',
        command: 'Command'
    };

    container.innerHTML = `
        <section class="space-y-6">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="page-title">Scheduled Tasks</h1>
                    <p class="mt-1 text-sm text-muted-foreground">Automate server and network operations on a timer</p>
                </div>
                <button class="inline-flex items-center gap-2 rounded-md btn-primary px-4 py-2 text-xs font-semibold uppercase tracking-wide transition" id="createTask">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New Task
                </button>
            </div>

            ${tasks.length === 0 ? `
                <div class="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center">
                    <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-semibold">No scheduled tasks</h3>
                    <p class="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Create tasks to automatically restart, backup, or run commands on your servers and networks.</p>
                </div>
            ` : `
                <div class="flex flex-col gap-3">
                    ${tasks.map(task => {
                    const isNetworkTask = !!task.networkId;
                    let targetName;
                    let typeLabel;
                    if (isNetworkTask) {
                        targetName = networks.find(n => n.id === task.networkId)?.name || task.networkId;
                        typeLabel = networkTypeLabels[task.type] || task.type;
                    } else {
                        targetName = servers.find(s => s.id === task.serverId)?.name || task.serverId;
                        typeLabel = serverTypeLabels[task.type] || task.type;
                    }
                    const interval = formatInterval(task.intervalMinutes);
                    const iconColor = task.enabled ? 'text-foreground' : 'text-muted-foreground';
                    const networkBadge = isNetworkTask ? '<span class="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">network</span>' : '';

                    return `
                        <article class="task-card flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
                            <div class="flex min-w-0 flex-1 items-center gap-3">
                                <div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-muted ${iconColor}">
                                    ${isNetworkTask ? `
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                                            <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
                                            <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
                                        </svg>
                                    ` : `
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                                            <circle cx="12" cy="12" r="10"/>
                                            <polyline points="12 6 12 12 16 14"/>
                                        </svg>
                                    `}
                                </div>
                                <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold">${escapeHtml(task.name)}</div>
                                    <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                        <span>${escapeHtml(typeLabel)}</span>
                                        <span>&middot;</span>
                                        <span>${escapeHtml(targetName)}</span>
                                        ${networkBadge}
                                        <span>&middot;</span>
                                        <span>Every ${escapeHtml(interval)}</span>
                                        ${task.command ? `<span>&middot;</span><code class="font-mono text-[11px] text-muted-foreground">${escapeHtml(task.command)}</code>` : ''}
                                        ${task.type === 'backup' && task.maxBackups ? `<span>&middot;</span><span>Keep ${task.maxBackups}</span>` : ''}
                                    </div>
                                    ${task.lastRun ? `<div class="mt-1 text-[11px] text-muted-foreground">Last run: ${escapeHtml(new Date(task.lastRun).toLocaleString())}</div>` : ''}
                                </div>
                            </div>
                            <div class="flex flex-shrink-0 items-center gap-2">
                                <button class="btn btn-secondary btn-sm" data-run="${escapeHtml(task.id)}" title="Run now">Run</button>
                                <button class="btn btn-sm ${task.enabled ? 'btn-secondary' : 'btn-success'}" data-toggle="${escapeHtml(task.id)}">${task.enabled ? 'Disable' : 'Enable'}</button>
                                <button class="btn btn-danger btn-sm" data-delete="${escapeHtml(task.id)}">Delete</button>
                            </div>
                        </article>
                    `;
                }).join('')}
                </div>
            `}
        </section>
    `;

    // Wire create task
    container.querySelector('#createTask')?.addEventListener('click', () => {
        showCreateTaskModal(servers, networks, container);
    });

    // Wire task actions
    container.querySelectorAll('[data-toggle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/schedule/${encodeURIComponent(btn.dataset.toggle)}/toggle`);
                showToast('Task updated', 'success');
                render(container);
            } catch (e) { showToast(e.message, 'error'); }
        });
    });

    container.querySelectorAll('[data-run]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/schedule/${encodeURIComponent(btn.dataset.run)}/execute`);
                showToast('Task executed', 'success');
            } catch (e) { showToast(e.message, 'error'); }
        });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = btn.dataset.delete;
            showModal('Delete Scheduled Task', `
                <p>Delete this scheduled task?</p>
                <p class="text-xs text-muted-foreground mt-1.5">The task will stop running. This cannot be undone.</p>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                    try {
                        await api.del(`/schedule/${encodeURIComponent(taskId)}`);
                        showToast('Task deleted', 'success');
                        render(container);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        });
    });
}

function showCreateTaskModal(servers, networks, container) {
    const close = showModal('Create Scheduled Task', `
        <div class="form-group">
            <label class="form-label">Target Type</label>
            <div class="flex gap-2" id="targetTypeToggle">
                <button class="btn btn-sm btn-primary" data-target-type="server" id="targetServerBtn">Server</button>
                <button class="btn btn-sm btn-secondary" data-target-type="network" id="targetNetworkBtn">Network</button>
            </div>
        </div>
        <div id="targetSection">
            <div class="form-group">
                <label class="form-label">Server</label>
                <select class="form-select" id="taskServer">
                    ${servers.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">Task Type</label>
            <select class="form-select" id="taskType">
                <option value="restart">Auto Restart</option>
                <option value="backup">Auto Backup</option>
                <option value="command">Run Command</option>
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Name</label>
            <input type="text" class="form-input" id="taskName" placeholder="e.g., Nightly Restart">
        </div>
        <div class="form-group">
            <label class="form-label">Interval (minutes)</label>
            <select class="form-select" id="taskInterval">
                <option value="30">Every 30 minutes</option>
                <option value="60">Every hour</option>
                <option value="180">Every 3 hours</option>
                <option value="360">Every 6 hours</option>
                <option value="720">Every 12 hours</option>
                <option value="1440">Every 24 hours</option>
            </select>
        </div>
        <div class="form-group hidden" id="commandGroup">
            <label class="form-label">Command</label>
            <input type="text" class="form-input" id="taskCommand" placeholder="e.g., say Server restarting in 5 minutes">
        </div>
        <div class="form-group hidden" id="backupRetentionGroup">
            <label class="form-label">Max Backups (retention)</label>
            <input type="number" class="form-input" id="taskMaxBackups" min="1" max="100" value="5" placeholder="5">
            <p class="mt-1 text-xs text-muted-foreground">Oldest scheduled backups will be deleted when this limit is exceeded</p>
        </div>
    `, [
        { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
        { id: 'create', label: 'Create Task', class: 'btn-primary', onClick: async () => {
            const type = document.querySelector('#taskType').value;
            const targetType = document.querySelector('#targetServerBtn').classList.contains('btn-primary') ? 'server' : 'network';
            const data = {
                type,
                name: document.querySelector('#taskName').value || undefined,
                intervalMinutes: parseInt(document.querySelector('#taskInterval').value),
                command: type === 'command' ? document.querySelector('#taskCommand').value : undefined,
                maxBackups: type === 'backup' ? parseInt(document.querySelector('#taskMaxBackups').value) || 5 : undefined
            };

            if (targetType === 'server') {
                data.serverId = document.querySelector('#taskServer')?.value;
            } else {
                data.networkId = document.querySelector('#taskNetwork')?.value;
            }

            try {
                await api.post('/schedule', data);
                showToast('Task created', 'success');
                render(container);
            } catch (e) { showToast(e.message, 'error'); }
        }}
    ]);

    let currentTargetType = 'server';

    function switchTargetType(type) {
        currentTargetType = type;
        const serverBtn = document.querySelector('#targetServerBtn');
        const networkBtn = document.querySelector('#targetNetworkBtn');
        const targetSection = document.querySelector('#targetSection');
        const taskType = document.querySelector('#taskType');

        if (type === 'server') {
            serverBtn.className = 'btn btn-sm btn-primary';
            networkBtn.className = 'btn btn-sm btn-secondary';
            targetSection.innerHTML = `
                <div class="form-group">
                    <label class="form-label">Server</label>
                    <select class="form-select" id="taskServer">
                        ${servers.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}
                    </select>
                </div>
            `;
            taskType.innerHTML = `
                <option value="restart">Auto Restart</option>
                <option value="backup">Auto Backup</option>
                <option value="command">Run Command</option>
            `;
        } else {
            serverBtn.className = 'btn btn-sm btn-secondary';
            networkBtn.className = 'btn btn-sm btn-primary';
            targetSection.innerHTML = `
                <div class="form-group">
                    <label class="form-label">Network</label>
                    <select class="form-select" id="taskNetwork">
                        ${networks.map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)}</option>`).join('')}
                    </select>
                </div>
            `;
            taskType.innerHTML = `
                <option value="network_start">Network Start</option>
                <option value="network_stop">Network Stop</option>
                <option value="network_restart">Network Restart</option>
                <option value="rolling_restart">Rolling Restart</option>
            `;
        }

        // Reset command and backup retention group visibility
        document.querySelector('#commandGroup')?.classList.add('hidden');
        document.querySelector('#backupRetentionGroup')?.classList.add('hidden');
    }

    // Wire target type toggle
    document.querySelector('#targetServerBtn')?.addEventListener('click', () => switchTargetType('server'));
    document.querySelector('#targetNetworkBtn')?.addEventListener('click', () => switchTargetType('network'));

    // Toggle command and backup retention fields based on task type
    document.querySelector('#taskType')?.addEventListener('change', (e) => {
        document.querySelector('#commandGroup')?.classList.toggle('hidden', e.target.value !== 'command');
        document.querySelector('#backupRetentionGroup')?.classList.toggle('hidden', e.target.value !== 'backup');
    });
}

export function destroy() {
    // No WS listeners on this page — nothing to clean up beyond DOM removal
}

function formatInterval(minutes) {
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${minutes / 60}h`;
    return `${minutes / 1440}d`;
}
