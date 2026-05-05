// FortunaPanel - Notification Center
// In-app notification feed for crashes, health alerts, and other events
import { ws } from '../websocket.js';
import { escapeHtml } from '../app.js';

const MAX_NOTIFICATIONS = 50;
let notifications = [];
let unreadCount = 0;
let panelOpen = false;

const SEVERITY = { error: 3, warning: 2, info: 1 };

/**
 * Initialize the notification center.
 * Call once after app init — attaches to the topbar.
 */
export function initNotificationCenter() {
    const topbarActions = document.querySelector('.topbar-actions');
    if (!topbarActions || document.getElementById('notifBell')) return;

    // Bell button
    const bell = document.createElement('button');
    bell.id = 'notifBell';
    bell.className = 'notif-bell';
    bell.setAttribute('aria-label', 'Notifications');
    bell.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="notif-badge" id="notifBadge" style="display:none">0</span>
    `;
    topbarActions.insertBefore(bell, topbarActions.firstChild);

    // Dropdown panel
    const panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.className = 'notif-panel';
    panel.innerHTML = `
        <div class="notif-panel-header">
            <span class="notif-panel-title">Notifications</span>
            <button class="notif-clear-btn" id="notifClear">Clear all</button>
        </div>
        <div class="notif-panel-body" id="notifList">
            <div class="notif-empty">No notifications</div>
        </div>
    `;
    topbarActions.appendChild(panel);

    // Toggle panel
    bell.addEventListener('click', (e) => {
        e.stopPropagation();
        panelOpen = !panelOpen;
        panel.classList.toggle('open', panelOpen);
        if (panelOpen) {
            unreadCount = 0;
            updateBadge();
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (panelOpen && !e.target.closest('#notifPanel') && !e.target.closest('#notifBell')) {
            panelOpen = false;
            panel.classList.remove('open');
        }
    });

    // Clear all
    document.getElementById('notifClear').addEventListener('click', () => {
        notifications = [];
        unreadCount = 0;
        updateBadge();
        renderNotifications();
    });

    // Subscribe to events
    ws.on('server-crash', (data) => {
        addNotification('error', 'Server Crashed',
            `${data.serverId} exited with code ${data.exitCode}${data.willRestart ? ' — auto-restarting' : ''}`,
            data.serverId);
    });

    ws.on('server-max-crashes', (data) => {
        addNotification('error', 'Max Crashes Reached',
            `${data.serverId} hit ${data.crashCount}/${data.maxAutoRestarts} crashes — auto-restart disabled`,
            data.serverId);
    });

    ws.on('health-changed', (data) => {
        if (data.status === 'unhealthy') {
            addNotification('warning', 'Server Unhealthy',
                `${data.serverName || data.serverId} failed health check`,
                data.serverId);
        }
    });

    ws.on('health-auto-restart', (data) => {
        addNotification('warning', 'Auto-Restart Triggered',
            `${data.serverName || data.serverId} restarted due to health failure`,
            data.serverId);
    });

    ws.on('resource-alert', (data) => {
        const details = [];
        if (data.cpu > (data.limits?.cpuPercent || 100)) details.push(`CPU ${data.cpu}%`);
        if (data.memory > (data.limits?.memoryMB || Infinity)) details.push(`Memory ${data.memory}MB`);
        addNotification('warning', 'Resource Limit Exceeded',
            `${data.serverId}: ${details.join(', ')}`,
            data.serverId);
    });

    ws.on('server-status', (data) => {
        if (data.status === 'stopped') {
            addNotification('info', 'Server Stopped', data.serverId, data.serverId);
        } else if (data.status === 'running') {
            addNotification('info', 'Server Started', data.serverId, data.serverId);
        }
    });
}

function addNotification(severity, title, message, serverId) {
    const notif = {
        id: Date.now() + Math.random(),
        severity,
        title,
        message,
        serverId,
        time: new Date()
    };
    notifications.unshift(notif);
    if (notifications.length > MAX_NOTIFICATIONS) {
        notifications = notifications.slice(0, MAX_NOTIFICATIONS);
    }
    if (!panelOpen) {
        unreadCount++;
        updateBadge();
    }
    renderNotifications();
}

function updateBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function renderNotifications() {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (notifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">No notifications</div>';
        return;
    }

    list.innerHTML = notifications.map(n => {
        const icon = n.severity === 'error'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
            : n.severity === 'warning'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

        const timeStr = formatTime(n.time);
        return `<div class="notif-item notif-${escapeHtml(n.severity)}">
            <div class="notif-icon">${icon}</div>
            <div class="notif-content">
                <div class="notif-title">${escapeHtml(n.title)}</div>
                <div class="notif-message">${escapeHtml(n.message)}</div>
            </div>
            <div class="notif-time">${escapeHtml(timeStr)}</div>
        </div>`;
    }).join('');
}

function formatTime(date) {
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}
