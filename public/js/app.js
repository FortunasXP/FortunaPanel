// FortunaPanel SPA Router & App Initialization
import { api } from './api.js';
import { ws } from './websocket.js';
import { replaceSelects, observeSelects } from './components/custom-select.js';
import { initNotificationCenter } from './components/notification-center.js';
import { initKeyboardShortcuts } from './components/keyboard-shortcuts.js';

document.documentElement.setAttribute('data-theme', 'dark');

// Page modules (lazy loaded)
const pages = {
    dashboard: () => import('./pages/dashboard.js'),
    servers: () => import('./pages/servers.js'),
    'server-detail': () => import('./pages/server-detail.js'),
    'create-server': () => import('./pages/create-server.js'),
    'file-manager': () => import('./pages/file-manager.js'),
    players: () => import('./pages/players.js'),
    settings: () => import('./pages/settings.js'),
    activity: () => import('./pages/activity.js'),
    jobs: () => import('./pages/jobs.js'),
    schedule: () => import('./pages/schedule.js'),
    networks: () => import('./pages/networks.js'),
    'network-detail': () => import('./pages/network-detail.js'),
    'create-network': () => import('./pages/create-network.js'),
};

// Map of top-level nav pages to the set of route page-names that should
// light up that top-level entry as active.
const NAV_GROUP_MATCH = {
    dashboard: ['dashboard', 'activity', 'jobs'],
    servers: ['servers', 'server-detail', 'file-manager', 'players', 'create-server'],
    networks: ['networks', 'network-detail', 'create-network'],
    schedule: ['schedule'],
};

class App {
    constructor() {
        this.currentPage = null;
        this.contentEl = document.getElementById('content');
        this.breadcrumbsEl = document.getElementById('breadcrumbs');
    }

    async init() {
        // Check authentication
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }

        try {
            await api.get('/auth/verify');
        } catch (e) {
            window.location.href = '/login.html';
            return;
        }

        // Connect WebSocket
        ws.connect();
        ws.on('reconnected', () => showToast('Reconnected to server', 'success'));
        ws.on('disconnected', () => showToast('Connection lost — reconnecting...', 'error'));

        // Notification center
        initNotificationCenter();

        // Keyboard shortcuts (press ? to show help)
        initKeyboardShortcuts();

        // Auto-replace native <select> elements globally (catches tab switches, modals, etc.)
        observeSelects(document.body);

        // Setup sidebar interactivity
        this.setupNav();
        this.setupCollapsibles();
        this.setupUserMenu();
        this.setupSidebarTrigger();
        this.setupLogout();

        // Handle browser back/forward
        window.addEventListener('popstate', () => this.route());

        // Populate recent servers group (fire & forget)
        this.loadRecentServers();

        // Initial route
        this.route();
    }

    /**
     * Wire navigation clicks on both top-level `.sidebar-menu-button[data-page]`
     * items (for non-collapsible items like Schedule) and sub-buttons
     * `.sidebar-menu-sub-button[data-page]`. Collapsible parents only toggle
     * their group — navigation happens via their sub-items.
     */
    setupNav() {
        // Top-level buttons that are NOT collapsible → navigate directly
        document.querySelectorAll('.sidebar > * .sidebar-menu-item:not([data-collapsible]) > .sidebar-menu-button[data-page]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const href = btn.getAttribute('href') || btn.dataset.href;
                if (href) this.navigate(href);
            });
        });

        // Sub-buttons → navigate
        document.querySelectorAll('.sidebar-menu-sub-button[data-page]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const href = btn.getAttribute('href');
                if (href) this.navigate(href);
            });
        });

        // Brand logo → dashboard
        document.querySelector('.sidebar-brand')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.navigate('/');
        });

        // Any nav element with data-page from user menu dropdown
        document.querySelectorAll('.sidebar-user-menu-item[data-page]').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.preventDefault();
                this.closeUserMenu();
                if (item.dataset.page === 'settings') {
                    const mod = await import('./pages/settings.js');
                    mod.openSettingsDialog();
                    return;
                }
                const href = item.getAttribute('href');
                if (href) this.navigate(href);
            });
        });
    }

    /**
     * Collapsible parents: clicking the parent button toggles `data-open` on
     * its `<li class="sidebar-menu-item">` ancestor. CSS handles the animation
     * and chevron rotation via the attribute selector.
     */
    setupCollapsibles() {
        document.querySelectorAll('.sidebar-menu-item[data-collapsible] > .sidebar-menu-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const item = btn.closest('.sidebar-menu-item');
                if (!item) return;
                const isOpen = item.dataset.open === 'true';
                item.dataset.open = isOpen ? 'false' : 'true';
            });
        });
    }

    /**
     * Footer user button → toggles the popover menu above it. Closes on
     * outside click or Escape.
     */
    setupUserMenu() {
        const trigger = document.getElementById('sidebarUser');
        const menu = document.getElementById('sidebarUserMenu');
        if (!trigger || !menu) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !menu.hasAttribute('hidden');
            if (isOpen) this.closeUserMenu();
            else this.openUserMenu();
        });

        document.addEventListener('click', (e) => {
            if (menu.hasAttribute('hidden')) return;
            if (!menu.contains(e.target) && !trigger.contains(e.target)) {
                this.closeUserMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.hasAttribute('hidden')) {
                this.closeUserMenu();
            }
        });

        // Populate the user name from storage if available
        const username = localStorage.getItem('fortuna-username') || 'admin';
        const nameEls = document.querySelectorAll('#sidebarUserName, #sidebarUserMenuName, #topbarUser');
        nameEls.forEach(el => { el.textContent = username; });
        const avatarEls = document.querySelectorAll('.sidebar-user-avatar');
        avatarEls.forEach(el => { el.textContent = (username[0] || 'A').toUpperCase(); });
    }

    openUserMenu() {
        const menu = document.getElementById('sidebarUserMenu');
        const trigger = document.getElementById('sidebarUser');
        if (!menu || !trigger) return;
        menu.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }

    closeUserMenu() {
        const menu = document.getElementById('sidebarUserMenu');
        const trigger = document.getElementById('sidebarUser');
        if (!menu || !trigger) return;
        menu.setAttribute('hidden', '');
        trigger.setAttribute('aria-expanded', 'false');
    }

    /**
     * Sidebar trigger (hamburger in topbar). On small screens this toggles
     * the drawer. On wide screens it toggles the collapsed state.
     */
    setupSidebarTrigger() {
        const trigger = document.getElementById('sidebarTrigger');
        const shell = document.querySelector('.sidebar-shell');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (!trigger || !shell) return;

        trigger.addEventListener('click', () => {
            if (window.matchMedia('(max-width: 768px)').matches) {
                shell.classList.toggle('sidebar-open');
            } else {
                const state = shell.dataset.sidebarState === 'collapsed' ? 'expanded' : 'collapsed';
                shell.dataset.sidebarState = state;
                localStorage.setItem('fortuna-sidebar-state', state);
            }
        });

        backdrop?.addEventListener('click', () => shell.classList.remove('sidebar-open'));

        // Restore persisted state on load (desktop only)
        if (!window.matchMedia('(max-width: 768px)').matches) {
            const saved = localStorage.getItem('fortuna-sidebar-state');
            if (saved) shell.dataset.sidebarState = saved;
        }
    }

    setupLogout() {
        document.getElementById('logoutBtn')?.addEventListener('click', async () => {
            // Best-effort revoke on the server so a stolen token can't be
            // replayed until it naturally expires. Failure shouldn't block
            // the client-side logout — we still clear local state below.
            try { await api.post('/auth/logout'); } catch (_) {}
            localStorage.removeItem('token');
            ws.disconnect();
            window.location.href = '/login.html';
        });
    }

    /**
     * Fetches the top-3 most recently active servers and renders them as
     * sidebar-menu-sub-buttons in the dynamic "Recent Servers" group.
     */
    async loadRecentServers() {
        const group = document.getElementById('sidebarRecentGroup');
        const list = document.getElementById('sidebarRecentList');
        if (!group || !list) return;

        try {
            const servers = await api.get('/servers');
            if (!Array.isArray(servers) || servers.length === 0) return;
            // Prefer running servers, then recently updated
            const sorted = [...servers].sort((a, b) => {
                const ra = a.status === 'running' ? 1 : 0;
                const rb = b.status === 'running' ? 1 : 0;
                if (rb !== ra) return rb - ra;
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            });
            const top = sorted.slice(0, 3);
            if (top.length === 0) return;

            list.innerHTML = top.map(s => `
                <li class="sidebar-menu-item">
                    <a class="sidebar-menu-button sidebar-menu-button-sm" data-page="server-detail" data-server-id="${escapeHtml(s.id)}" href="/server/${encodeURIComponent(s.id)}">
                        <span class="status-dot ${statusDotClass(s.status)}" data-sidebar-status="${escapeHtml(s.id)}" style="width:6px;height:6px;flex-shrink:0;"></span>
                        <span class="truncate">${escapeHtml(s.name)}</span>
                    </a>
                </li>
            `).join('');
            group.removeAttribute('hidden');

            // Wire navigation
            list.querySelectorAll('a[href]').forEach(a => {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.navigate(a.getAttribute('href'));
                });
            });

            // Subscribe to server status events to keep dots live
            if (!this._sidebarStatusListener) {
                this._sidebarStatusListener = (data) => {
                    if (!data || !data.serverId) return;
                    const dot = document.querySelector(`[data-sidebar-status="${CSS.escape(data.serverId)}"]`);
                    if (dot) {
                        dot.className = `status-dot ${statusDotClass(data.status)}`;
                        dot.style.width = '6px';
                        dot.style.height = '6px';
                        dot.style.flexShrink = '0';
                    }
                };
                ws.on('server-status', this._sidebarStatusListener);
            }
        } catch (e) {
            // Silent — recent list is optional
        }
    }

    navigate(path) {
        history.pushState(null, '', path);
        this.route();
        // Close mobile drawer after navigation
        document.querySelector('.sidebar-shell')?.classList.remove('sidebar-open');
    }

    async route() {
        const path = window.location.pathname;
        let pageName = 'dashboard';
        let params = {};

        if (path === '/' || path === '') {
            pageName = 'dashboard';
        } else if (path === '/servers') {
            pageName = 'servers';
        } else if (path === '/create') {
            pageName = 'create-server';
        } else if (path === '/players') {
            pageName = 'players';
        } else if (path === '/settings') {
            // Settings is now a dialog. Keep the URL bookmarkable by
            // rewriting to `/` and opening the dialog once dashboard renders.
            window.history.replaceState(null, '', '/');
            pageName = 'dashboard';
            import('./pages/settings.js').then(m => m.openSettingsDialog()).catch(() => {});
        } else if (path === '/activity') {
            pageName = 'activity';
        } else if (path === '/jobs') {
            pageName = 'jobs';
        } else if (path === '/schedule') {
            pageName = 'schedule';
        } else if (path === '/networks') {
            pageName = 'networks';
        } else if (path === '/create-network') {
            pageName = 'create-network';
        } else if (path.match(/^\/network\/([^/]+)$/)) {
            pageName = 'network-detail';
            params.id = path.match(/^\/network\/([^/]+)$/)[1];
        } else if (path.match(/^\/server\/([^/]+)\/files/)) {
            pageName = 'file-manager';
            params.id = path.match(/^\/server\/([^/]+)\/files/)[1];
        } else if (path.match(/^\/server\/([^/]+)\/players/)) {
            pageName = 'players';
            params.id = path.match(/^\/server\/([^/]+)\/players/)[1];
        } else if (path.match(/^\/server\/([^/]+)$/)) {
            pageName = 'server-detail';
            params.id = path.match(/^\/server\/([^/]+)$/)[1];
        }

        this.updateActiveNav(pageName, path);
        await this.loadPage(pageName, params);
    }

    /**
     * Applies `.active` to the appropriate sidebar items:
     * - Top-level `.sidebar-menu-button[data-page]` gets `.active` if the
     *   current route belongs to its group (see NAV_GROUP_MATCH).
     * - Sub-button `.sidebar-menu-sub-button[href]` gets `.active` if its
     *   href exactly matches the current path.
     * - Also auto-opens the collapsible that contains the active route.
     */
    updateActiveNav(pageName, path) {
        // Top-level buttons
        document.querySelectorAll('.sidebar-menu-button[data-page]').forEach(btn => {
            const page = btn.dataset.page;
            const group = NAV_GROUP_MATCH[page];
            const matches = group ? group.includes(pageName) : page === pageName;
            btn.classList.toggle('active', matches);

            // Auto-open the collapsible that contains the active route
            const item = btn.closest('.sidebar-menu-item[data-collapsible]');
            if (item && matches) item.dataset.open = 'true';
        });

        // Sub-buttons → exact path match
        document.querySelectorAll('.sidebar-menu-sub-button[href]').forEach(a => {
            const href = a.getAttribute('href');
            a.classList.toggle('active', href === path);
        });

        // User menu items (Settings, Activity)
        document.querySelectorAll('.sidebar-user-menu-item[data-page]').forEach(item => {
            const page = item.dataset.page;
            item.classList.toggle('active', page === pageName);
        });
    }

    async loadPage(pageName, params = {}) {
        // Destroy previous page if it has a destroy method
        if (this.currentPage && this.currentPage.destroy) {
            this.currentPage.destroy();
        }

        // Show loading
        this.contentEl.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

        try {
            const loader = pages[pageName];
            if (!loader) {
                this.contentEl.innerHTML = '<div class="empty-state"><h3>Page not found</h3></div>';
                return;
            }

            const module = await loader();
            this.contentEl.innerHTML = '';

            // Animate in
            const wrapper = document.createElement('div');
            wrapper.className = 'page-enter';
            this.contentEl.appendChild(wrapper);

            await module.render(wrapper, params);

            // Replace native <select> elements with custom dark dropdowns
            replaceSelects(wrapper);

            // Trigger animation
            requestAnimationFrame(() => {
                wrapper.classList.add('page-enter-active');
                wrapper.classList.remove('page-enter');
            });

            // Update breadcrumbs
            if (module.breadcrumbs) {
                this.setBreadcrumbs(module.breadcrumbs(params));
            }

            this.currentPage = module;
        } catch (e) {
            console.error('Page load error:', e);
            this.contentEl.innerHTML = `<div class="empty-state"><h3>Error loading page</h3><p>${escapeHtml(e.message)}</p></div>`;
        }
    }

    setBreadcrumbs(crumbs) {
        this.breadcrumbsEl.innerHTML = crumbs
            .map((c, i) => {
                if (i < crumbs.length - 1) {
                    return `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a><span class="separator">/</span>`;
                }
                return `<span>${escapeHtml(c.label)}</span>`;
            })
            .join('');

        // Wire breadcrumb links
        this.breadcrumbsEl.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigate(a.getAttribute('href'));
            });
        });
    }
}

// Toast utility
const toastIcons = {
    success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

// Maps a server status to a sidebar status-dot class name.
// Keep in sync with .status-dot.* CSS rules in components.css.
function statusDotClass(status) {
    if (status === 'running') return 'online';
    if (status === 'starting' || status === 'stopping') return 'starting';
    return 'offline';
}

// Escape a string for safe interpolation into HTML. Use this for ANY
// value that came from the server, an API response, or user input before
// putting it inside a template literal that will be assigned to innerHTML.
// Covers both text-content and attribute-value contexts (escapes quotes).
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Icon is a trusted static SVG; message is escaped so a malicious
    // API error string can't inject markup.
    toast.innerHTML = `${toastIcons[type] || toastIcons.info}<span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Modal utility. `content` is allowed to be raw HTML because callers build
// structured forms; `title` and button labels are always escaped.
export function showModal(title, content, actions = []) {
    const overlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('modal');

    modal.innerHTML = `
        <div class="modal-header">
            <h3 class="modal-title">${escapeHtml(title)}</h3>
            <button class="modal-close" id="modalClose">&times;</button>
        </div>
        <div class="modal-body">${content}</div>
        ${actions.length ? `<div class="modal-footer">${actions.map(a =>
            `<button class="btn ${escapeHtml(a.class || 'btn-secondary')}" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`
        ).join('')}</div>` : ''}
    `;

    overlay.classList.add('active');

    // Replace native selects in modal with dark custom dropdowns
    replaceSelects(modal);

    const close = () => overlay.classList.remove('active');
    document.getElementById('modalClose').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // Wire action buttons
    actions.forEach(a => {
        const btn = modal.querySelector(`[data-action="${a.id}"]`);
        if (btn) {
            btn.onclick = () => { if (a.onClick) a.onClick(); close(); };
        }
    });

    return close;
}

// Global app reference
export const app = new App();

// Initialize
app.init();
