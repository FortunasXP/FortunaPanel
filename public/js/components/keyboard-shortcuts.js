// FortunaPanel - Keyboard Shortcuts
// Global hotkeys for quick navigation and actions

import { app, showModal } from '../app.js';

const SHORTCUTS = [
    { key: 'g d', label: 'Go to Dashboard', action: () => app.navigate('/') },
    { key: 'g s', label: 'Go to Servers', action: () => app.navigate('/servers') },
    { key: 'g n', label: 'Go to Networks', action: () => app.navigate('/networks') },
    { key: 'g t', label: 'Go to Schedule', action: () => app.navigate('/schedule') },
    { key: 'g a', label: 'Go to Activity', action: () => app.navigate('/activity') },
    { key: 'c', label: 'Create new server', action: () => app.navigate('/create') },
    { key: '?', label: 'Show shortcuts', action: () => showShortcutsDialog() },
];

let pendingPrefix = null;
let prefixTimer = null;
let initialized = false;

/**
 * Initialize keyboard shortcuts. Call once at app start.
 */
export function initKeyboardShortcuts() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
    // Don't intercept when typing in inputs/textareas/selects or contenteditable
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

    // Don't intercept when a modal is open
    const overlay = document.getElementById('modalOverlay');
    if (overlay && overlay.classList.contains('active')) return;

    // Ctrl/Cmd/Alt combos are not ours
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key;

    // Two-key combos (g + letter)
    if (pendingPrefix) {
        const combo = `${pendingPrefix} ${key}`;
        clearTimeout(prefixTimer);
        pendingPrefix = null;

        const shortcut = SHORTCUTS.find(s => s.key === combo);
        if (shortcut) {
            e.preventDefault();
            shortcut.action();
            return;
        }
        // No match — fall through
        return;
    }

    // Start a prefix
    if (key === 'g') {
        pendingPrefix = 'g';
        prefixTimer = setTimeout(() => { pendingPrefix = null; }, 800);
        return;
    }

    // Single-key shortcuts
    const shortcut = SHORTCUTS.find(s => s.key === key);
    if (shortcut) {
        e.preventDefault();
        shortcut.action();
    }
}

/**
 * Show the keyboard shortcuts help dialog.
 */
function showShortcutsDialog() {
    const groups = [
        {
            title: 'Navigation',
            items: SHORTCUTS.filter(s => s.key.startsWith('g '))
        },
        {
            title: 'Actions',
            items: SHORTCUTS.filter(s => !s.key.startsWith('g ') && s.key !== '?')
        },
        {
            title: 'Help',
            items: SHORTCUTS.filter(s => s.key === '?')
        }
    ];

    const content = groups.map(g => `
        <div class="mb-4">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">${g.title}</h4>
            <div class="space-y-1.5">
                ${g.items.map(item => `
                    <div class="flex items-center justify-between py-1">
                        <span class="text-sm text-foreground">${item.label}</span>
                        <kbd class="kbd-shortcut">${formatKey(item.key)}</kbd>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    showModal('Keyboard Shortcuts', content, [
        { id: 'close', label: 'Close', class: 'btn-secondary' }
    ]);
}

function formatKey(key) {
    return key.split(' ').map(k =>
        `<span class="kbd-key">${k === ' ' ? 'Space' : k}</span>`
    ).join('<span class="text-muted-foreground mx-1">then</span>');
}
