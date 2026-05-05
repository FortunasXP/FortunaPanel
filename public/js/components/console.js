// FortunaPanel - Console Terminal Component
import { ws } from '../websocket.js';
import { api } from '../api.js';
import { escapeHtml } from '../app.js';

const MAX_LINES = 1000;

export class ConsoleComponent {
    constructor(container, serverId) {
        this.container = container;
        this.serverId = serverId;
        this.commandHistory = [];
        this.historyIndex = -1;
        this.autoScroll = true;
        this.lineCount = 0;
        this.searchMatches = [];
        this.searchIndex = -1;
        this.searchOpen = false;

        // Filter state
        this.filterLevel = 'all';
        this.filterText = '';
        this.visibleCount = 0;

        this.render();
        this.attach();
    }

    render() {
        this.container.innerHTML = `
            <div class="console-container">
                <div class="console-header">
                    <div class="console-header-left">
                        <span class="console-status-dot" data-status="connecting" title="Connecting..."></span>
                        <span class="console-title">Console</span>
                        <span class="console-meta" data-line-count>0 lines</span>
                        <span class="console-line-count" data-filter-count></span>
                    </div>
                    <div class="console-header-actions">
                        <div class="flex items-center gap-1 mr-2" data-filter-buttons>
                            <button type="button" class="console-filter-btn active" data-filter-level="all">All</button>
                            <button type="button" class="console-filter-btn" data-filter-level="info">Info</button>
                            <button type="button" class="console-filter-btn" data-filter-level="warn">Warn</button>
                            <button type="button" class="console-filter-btn" data-filter-level="error">Error</button>
                        </div>
                        <div class="console-search" data-filter-search-wrap>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input type="text" class="console-search-input" data-filter-search placeholder="Filter..." autocomplete="off" spellcheck="false">
                        </div>
                        <div class="console-search" data-search-wrap hidden>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input type="text" class="console-search-input" id="consoleSearch" placeholder="Search..." autocomplete="off" spellcheck="false">
                            <span class="console-search-count" data-search-count></span>
                            <button type="button" class="console-icon-btn" data-search-prev title="Previous match" aria-label="Previous match">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
                            </button>
                            <button type="button" class="console-icon-btn" data-search-next title="Next match" aria-label="Next match">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                            </button>
                            <button type="button" class="console-icon-btn" data-search-clear title="Clear" aria-label="Clear search">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                        <button type="button" class="console-icon-btn" data-toggle-search title="Search (Ctrl+F)" aria-label="Search">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        </button>
                        <button type="button" class="console-icon-btn" data-toggle-autoscroll title="Auto-scroll is on" aria-label="Toggle auto-scroll" data-autoscroll="on">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/><path d="M12 3v12"/></svg>
                        </button>
                        <button type="button" class="console-icon-btn" data-clear title="Clear console" aria-label="Clear console">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                        <div class="console-logs-wrap">
                            <button type="button" class="console-icon-btn" data-download-logs title="Download logs" aria-label="Download logs" aria-expanded="false">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                            <div class="console-logs-menu" data-logs-menu hidden></div>
                        </div>
                    </div>
                </div>
                <div class="console-output" data-output></div>
                <div class="console-input-bar">
                    <span class="console-prompt" aria-hidden="true">&gt;</span>
                    <input type="text" class="console-input" id="consoleInput"
                           placeholder="Type a command and press Enter…" autocomplete="off" spellcheck="false">
                </div>
            </div>
        `;

        this.outputEl = this.container.querySelector('[data-output]');
        this.inputEl = this.container.querySelector('#consoleInput');
        this.searchWrapEl = this.container.querySelector('[data-search-wrap]');
        this.searchEl = this.container.querySelector('#consoleSearch');
        this.searchCountEl = this.container.querySelector('[data-search-count]');
        this.lineCountEl = this.container.querySelector('[data-line-count]');
        this.statusDotEl = this.container.querySelector('.console-status-dot');
        this.autoscrollBtn = this.container.querySelector('[data-toggle-autoscroll]');
        this.logsMenuEl = this.container.querySelector('[data-logs-menu]');
        this.downloadBtn = this.container.querySelector('[data-download-logs]');
        this.filterCountEl = this.container.querySelector('[data-filter-count]');
        this.filterSearchEl = this.container.querySelector('[data-filter-search]');
        this.filterButtonsEl = this.container.querySelector('[data-filter-buttons]');
    }

    attach() {
        // Subscribe to server console
        ws.subscribe(this.serverId);
        this._setStatus('connected');

        this._onConsole = (data) => {
            if (data.serverId === this.serverId) {
                this.addLine(data.line, data.level, data.timestamp);
            }
        };
        ws.on('console', this._onConsole);

        this._onConnect = () => this._setStatus('connected');
        this._onDisconnect = () => this._setStatus('disconnected');
        ws.on('connected', this._onConnect);
        ws.on('disconnected', this._onDisconnect);

        // Input handling
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.inputEl.value.trim();
                if (cmd) {
                    ws.sendCommand(this.serverId, cmd);
                    this.commandHistory.unshift(cmd);
                    if (this.commandHistory.length > 50) this.commandHistory.pop();
                    this.historyIndex = -1;
                    this.inputEl.value = '';
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex < this.commandHistory.length - 1) {
                    this.historyIndex++;
                    this.inputEl.value = this.commandHistory[this.historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.inputEl.value = this.commandHistory[this.historyIndex];
                } else {
                    this.historyIndex = -1;
                    this.inputEl.value = '';
                }
            }
        });

        // Detect manual scroll
        this.outputEl.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = this.outputEl;
            this.autoScroll = (scrollHeight - scrollTop - clientHeight) < 50;
            this._reflectAutoscrollBtn();
        });

        // Ctrl/Cmd + F opens search
        this._onKeydown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                // Only intercept when focus is inside the console
                if (this.container.contains(document.activeElement)) {
                    e.preventDefault();
                    this._openSearch();
                }
            }
        };
        this.container.addEventListener('keydown', this._onKeydown);

        // Search handling
        let searchDebounce = null;
        this.searchEl.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => this._doSearch(), 150);
        });
        this.searchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) this._searchPrev();
                else this._searchNext();
            } else if (e.key === 'Escape') {
                this._closeSearch();
                this.inputEl.focus();
            }
        });

        this.container.querySelector('[data-search-prev]')?.addEventListener('click', () => this._searchPrev());
        this.container.querySelector('[data-search-next]')?.addEventListener('click', () => this._searchNext());
        this.container.querySelector('[data-search-clear]')?.addEventListener('click', () => this._closeSearch());
        this.container.querySelector('[data-toggle-search]')?.addEventListener('click', () => this._openSearch());

        // Toolbar actions
        this.container.querySelector('[data-clear]')?.addEventListener('click', () => this._clearConsole());
        this.autoscrollBtn?.addEventListener('click', () => this._toggleAutoscroll());

        // Download logs dropdown
        this.downloadBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleLogMenu();
        });

        this._onDocClick = (e) => {
            if (!this.logsMenuEl) return;
            if (this.logsMenuEl.hasAttribute('hidden')) return;
            if (this.logsMenuEl.contains(e.target) || this.downloadBtn.contains(e.target)) return;
            this._closeLogMenu();
        };
        document.addEventListener('click', this._onDocClick);

        // Filter level buttons
        this.filterButtonsEl?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-filter-level]');
            if (!btn) return;
            this.filterLevel = btn.dataset.filterLevel;
            this.filterButtonsEl.querySelectorAll('.console-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this._applyFilters();
        });

        // Filter text input
        let filterDebounce = null;
        this.filterSearchEl?.addEventListener('input', () => {
            clearTimeout(filterDebounce);
            filterDebounce = setTimeout(() => {
                this.filterText = this.filterSearchEl.value.trim().toLowerCase();
                this._applyFilters();
            }, 150);
        });
    }

    _setStatus(status) {
        if (!this.statusDotEl) return;
        this.statusDotEl.dataset.status = status;
        const labels = {
            connected: 'Connected — streaming live output',
            disconnected: 'Disconnected — reconnecting',
            connecting: 'Connecting...'
        };
        this.statusDotEl.title = labels[status] || status;
    }

    _updateLineCount() {
        if (this.lineCountEl) {
            this.lineCountEl.textContent = `${this.lineCount} line${this.lineCount === 1 ? '' : 's'}`;
        }
    }

    _clearConsole() {
        this.outputEl.innerHTML = '';
        this.lineCount = 0;
        this.visibleCount = 0;
        this._updateLineCount();
        this._updateFilterCount();
        this.searchMatches = [];
        this.searchIndex = -1;
        if (this.searchCountEl) this.searchCountEl.textContent = '';
    }

    _toggleAutoscroll() {
        this.autoScroll = !this.autoScroll;
        this._reflectAutoscrollBtn();
        if (this.autoScroll) this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }

    _reflectAutoscrollBtn() {
        if (!this.autoscrollBtn) return;
        this.autoscrollBtn.dataset.autoscroll = this.autoScroll ? 'on' : 'off';
        this.autoscrollBtn.title = this.autoScroll ? 'Auto-scroll is on' : 'Auto-scroll is off';
    }

    _openSearch() {
        if (!this.searchWrapEl) return;
        this.searchWrapEl.removeAttribute('hidden');
        this.searchOpen = true;
        this.searchEl.focus();
        this.searchEl.select();
    }

    _closeSearch() {
        if (!this.searchWrapEl) return;
        this.searchEl.value = '';
        this._doSearch();
        this.searchWrapEl.setAttribute('hidden', '');
        this.searchOpen = false;
    }

    _doSearch() {
        const query = this.searchEl.value.trim().toLowerCase();

        this.outputEl.querySelectorAll('.console-line.search-highlight').forEach(el => {
            el.classList.remove('search-highlight');
        });

        if (!query) {
            if (this.searchCountEl) this.searchCountEl.textContent = '';
            this.searchMatches = [];
            this.searchIndex = -1;
            return;
        }

        this.searchMatches = [];
        this.outputEl.querySelectorAll('.console-line').forEach(line => {
            if (line.textContent.toLowerCase().includes(query)) {
                line.classList.add('search-highlight');
                this.searchMatches.push(line);
            }
        });

        if (this.searchMatches.length > 0) {
            this.searchIndex = this.searchMatches.length - 1;
            if (this.searchCountEl) this.searchCountEl.textContent = `${this.searchIndex + 1}/${this.searchMatches.length}`;
            this.searchMatches[this.searchIndex].scrollIntoView({ block: 'center' });
        } else {
            if (this.searchCountEl) this.searchCountEl.textContent = '0';
            this.searchIndex = -1;
        }
    }

    _searchNext() {
        if (this.searchMatches.length === 0) return;
        this.searchIndex = (this.searchIndex + 1) % this.searchMatches.length;
        if (this.searchCountEl) this.searchCountEl.textContent = `${this.searchIndex + 1}/${this.searchMatches.length}`;
        this.searchMatches[this.searchIndex].scrollIntoView({ block: 'center' });
    }

    _searchPrev() {
        if (this.searchMatches.length === 0) return;
        this.searchIndex = (this.searchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
        if (this.searchCountEl) this.searchCountEl.textContent = `${this.searchIndex + 1}/${this.searchMatches.length}`;
        this.searchMatches[this.searchIndex].scrollIntoView({ block: 'center' });
    }

    _toggleLogMenu() {
        if (!this.logsMenuEl) return;
        const isHidden = this.logsMenuEl.hasAttribute('hidden');
        if (isHidden) this._openLogMenu();
        else this._closeLogMenu();
    }

    async _openLogMenu() {
        if (!this.logsMenuEl) return;
        this.logsMenuEl.innerHTML = '<div class="console-logs-empty">Loading…</div>';
        this.logsMenuEl.removeAttribute('hidden');
        this.downloadBtn?.setAttribute('aria-expanded', 'true');

        try {
            const data = await api.get(`/servers/${encodeURIComponent(this.serverId)}/logs`);
            const logs = data.logs || [];

            if (logs.length === 0) {
                this.logsMenuEl.innerHTML = '<div class="console-logs-empty">No logs yet</div>';
                return;
            }

            this.logsMenuEl.innerHTML = logs.slice(0, 10).map(log => `
                <a class="console-log-item" href="/api/servers/${encodeURIComponent(this.serverId)}/logs/${encodeURIComponent(log.filename)}" target="_blank" rel="noopener">
                    <span class="console-log-date">${escapeHtml(log.date)}</span>
                    <span class="console-log-size">${escapeHtml(formatBytes(log.size))}</span>
                </a>
            `).join('');
        } catch (e) {
            this.logsMenuEl.innerHTML = '<div class="console-logs-empty">Failed to load logs</div>';
        }
    }

    _closeLogMenu() {
        if (!this.logsMenuEl) return;
        this.logsMenuEl.setAttribute('hidden', '');
        this.downloadBtn?.setAttribute('aria-expanded', 'false');
    }

    addLine(text, level = 'info', timestamp = null) {
        // Detect level from text patterns if level is generic
        const detectedLevel = this._detectLevel(text, level);

        const line = document.createElement('div');
        line.className = `console-line ${detectedLevel}`;
        line.dataset.level = detectedLevel;

        // Build timestamp prefix + text content; textContent keeps it safe
        const t = timestamp ? new Date(timestamp) : new Date();
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');

        const ts = document.createElement('span');
        ts.className = 'console-line-time';
        ts.textContent = `${hh}:${mm}:${ss}`;
        line.appendChild(ts);

        const body = document.createElement('span');
        body.className = 'console-line-text';
        body.textContent = text;
        line.appendChild(body);

        // Apply current filters to the new line
        const visible = this._lineMatchesFilter(line);
        if (!visible) {
            line.style.display = 'none';
        }

        this.outputEl.appendChild(line);
        this.lineCount++;
        if (visible) this.visibleCount++;
        this._updateLineCount();
        this._updateFilterCount();

        while (this.lineCount > MAX_LINES) {
            const removed = this.outputEl.firstChild;
            if (removed && removed.style.display !== 'none') {
                this.visibleCount--;
            }
            removed?.remove();
            this.lineCount--;
        }

        if (this.autoScroll && visible) {
            this.outputEl.scrollTop = this.outputEl.scrollHeight;
        }
    }

    _detectLevel(text, providedLevel) {
        // If the server already provided a meaningful level, use it
        if (providedLevel === 'warn' || providedLevel === 'error') return providedLevel;

        // Parse text for common log level patterns
        const upper = text.toUpperCase();
        if (/\[(WARN|WARNING)\]/.test(upper)) return 'warn';
        if (/\[(ERROR|SEVERE|FATAL)\]/.test(upper)) return 'error';
        if (/\[(INFO)\]/.test(upper)) return 'info';

        return providedLevel || 'info';
    }

    _lineMatchesFilter(lineEl) {
        const level = lineEl.dataset.level;
        const textEl = lineEl.querySelector('.console-line-text');
        const text = textEl ? textEl.textContent.toLowerCase() : '';

        // Level filter
        if (this.filterLevel !== 'all' && level !== this.filterLevel) {
            return false;
        }

        // Text filter
        if (this.filterText && !text.includes(this.filterText)) {
            return false;
        }

        return true;
    }

    _applyFilters() {
        this.visibleCount = 0;
        const lines = this.outputEl.querySelectorAll('.console-line');
        lines.forEach(line => {
            if (this._lineMatchesFilter(line)) {
                line.style.display = '';
                this.visibleCount++;
            } else {
                line.style.display = 'none';
            }
        });
        this._updateFilterCount();

        if (this.autoScroll) {
            this.outputEl.scrollTop = this.outputEl.scrollHeight;
        }
    }

    _updateFilterCount() {
        if (!this.filterCountEl) return;
        const hasFilter = this.filterLevel !== 'all' || this.filterText;
        if (hasFilter) {
            this.filterCountEl.textContent = `Showing ${this.visibleCount} of ${this.lineCount} lines`;
        } else {
            this.filterCountEl.textContent = '';
        }
    }

    loadHistory(lines) {
        for (const entry of lines) {
            this.addLine(entry.line, entry.level, entry.timestamp);
        }
    }

    destroy() {
        ws.unsubscribe(this.serverId);
        if (this._onConsole) ws.off('console', this._onConsole);
        if (this._onConnect) ws.off('connected', this._onConnect);
        if (this._onDisconnect) ws.off('disconnected', this._onDisconnect);
        if (this._onDocClick) document.removeEventListener('click', this._onDocClick);
        if (this._onKeydown) this.container.removeEventListener('keydown', this._onKeydown);
    }

    focus() {
        this.inputEl?.focus();
    }
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}
