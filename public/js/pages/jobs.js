// FortunaPanel - Jobs Page
import { api } from '../api.js';
import { ws } from '../websocket.js';
import { showToast, escapeHtml } from '../app.js';

let jobs = [];
let migrations = null;
let wsHandler = null;
let refreshTimer = null;
let containerRef = null;

export function breadcrumbs() {
    return [{ label: 'Jobs', href: '/jobs' }];
}

const STATUS_STYLES = {
    queued:    { dot: 'bg-muted-foreground/60',  text: 'text-muted-foreground' },
    running:   { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
    completed: { dot: 'bg-emerald-500', text: 'text-emerald-400' },
    failed:    { dot: 'bg-destructive', text: 'text-destructive' },
    cancelled: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};

function statusStyle(status) {
    return STATUS_STYLES[status] || STATUS_STYLES.queued;
}

function formatTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString();
}

function renderMigrations() {
    if (!migrations) return '';
    if (!migrations.sqliteEnabled) {
        return `
            <div class="rounded-lg border border-border bg-card p-5">
                <div class="text-sm font-semibold text-foreground">Storage Migration</div>
                <p class="mt-1 text-xs text-muted-foreground">SQLite is not enabled in this runtime.</p>
            </div>
        `;
    }

    return `
        <div class="rounded-lg border border-border bg-card p-5">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <div class="text-sm font-semibold text-foreground">Storage Migration</div>
                    <div class="mt-1 text-xs text-muted-foreground">Database: <span class="font-mono">${escapeHtml(migrations.dbPath || '-')}</span></div>
                </div>
                <button class="btn btn-secondary btn-sm" id="refreshMigrations">Refresh</button>
            </div>
            <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                ${(migrations.migrations || []).map(m => `
                    <div class="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                        <div class="text-xs font-semibold text-foreground">${escapeHtml(m.key)}</div>
                        <div class="mt-1 text-[11px] text-muted-foreground">
                            ${m.migrated ? `migrated &middot; ${escapeHtml(formatTime(m.completedAt))}` : 'not migrated'}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderJobs() {
    if (!jobs.length) {
        return `
            <div class="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <rect x="3" y="4" width="18" height="4" rx="1"/>
                        <rect x="3" y="10" width="18" height="4" rx="1"/>
                        <rect x="3" y="16" width="18" height="4" rx="1"/>
                    </svg>
                </div>
                <h3 class="mt-4 text-base font-semibold">No jobs yet</h3>
                <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Async jobs will appear here when you run backup, download, or restart operations in async mode.</p>
            </div>
        `;
    }

    return `
        <div class="space-y-2.5">
            ${jobs.map(job => {
                const s = statusStyle(job.status);
                const pct = Math.max(0, Math.min(100, job.progress || 0));
                return `
                    <div class="rounded-lg border border-border bg-card p-4">
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="h-2 w-2 shrink-0 rounded-full ${s.dot}"></span>
                                    <div class="text-sm font-semibold text-foreground">${escapeHtml(job.name || job.type)}</div>
                                    <span class="text-[10px] font-medium uppercase tracking-wider ${s.text}">${escapeHtml(job.status)}</span>
                                    <span class="font-mono text-[11px] text-muted-foreground/70">${escapeHtml(job.id)}</span>
                                </div>
                                <div class="mt-1 text-xs text-muted-foreground">
                                    type: <span class="font-mono">${escapeHtml(job.type)}</span>
                                    <span class="mx-1 opacity-40">&middot;</span>
                                    created: ${escapeHtml(formatTime(job.createdAt))}
                                </div>
                                ${job.error ? `<div class="mt-2 text-xs text-destructive">${escapeHtml(job.error)}</div>` : ''}
                                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div class="h-full bg-primary transition-all duration-300" style="width:${pct}%"></div>
                                </div>
                                ${job.message ? `<div class="mt-2 text-[11px] text-muted-foreground">${escapeHtml(job.message)}</div>` : ''}
                            </div>
                            <div class="flex shrink-0 items-center gap-2">
                                ${job.status === 'queued' ? `<button class="btn btn-danger btn-sm" data-cancel="${escapeHtml(job.id)}">Cancel</button>` : ''}
                                <button class="btn btn-secondary btn-sm" data-copy="${escapeHtml(job.id)}">Copy ID</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function attachHandlers() {
    if (!containerRef) return;

    containerRef.querySelectorAll('[data-cancel]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.post(`/jobs/${btn.dataset.cancel}/cancel`, {});
                showToast('Job cancelled', 'success');
                await loadJobs();
                rerender();
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    });

    containerRef.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(btn.dataset.copy);
                showToast('Job ID copied', 'success');
            } catch {
                showToast('Failed to copy job ID', 'error');
            }
        });
    });

    containerRef.querySelector('#refreshJobs')?.addEventListener('click', async () => {
        await loadJobs();
        rerender();
    });

    containerRef.querySelector('#refreshMigrations')?.addEventListener('click', async () => {
        await loadMigrations();
        rerender();
    });
}

function rerender() {
    if (!containerRef) return;
    containerRef.innerHTML = `
        <section class="space-y-6">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Jobs</h1>
                    <p class="mt-1 text-sm text-muted-foreground">Track async operations and storage migrations</p>
                </div>
                <button class="btn btn-secondary btn-sm" id="refreshJobs">Refresh</button>
            </div>
            ${renderMigrations()}
            <div>${renderJobs()}</div>
        </section>
    `;
    attachHandlers();
}

async function loadJobs() {
    try {
        const data = await api.get('/jobs?limit=100');
        jobs = data.jobs || [];
    } catch (e) {
        jobs = [];
        showToast(`Failed to load jobs: ${e.message}`, 'error');
    }
}

async function loadMigrations() {
    try {
        migrations = await api.get('/jobs/migrations');
    } catch {
        migrations = null;
    }
}

function upsertJob(job) {
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx === -1) jobs.unshift(job);
    else jobs[idx] = job;
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function render(container) {
    containerRef = container;

    await Promise.all([loadJobs(), loadMigrations()]);
    rerender();

    wsHandler = (msg) => {
        if (!msg?.job) return;
        upsertJob(msg.job);
        rerender();
    };
    ws.on('job-update', wsHandler);

    refreshTimer = setInterval(async () => {
        try {
            await loadJobs();
            rerender();
        } catch {}
    }, 5000);
}

export function destroy() {
    if (wsHandler) {
        ws.off('job-update', wsHandler);
        wsHandler = null;
    }
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    containerRef = null;
}
