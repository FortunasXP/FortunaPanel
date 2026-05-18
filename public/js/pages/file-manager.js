// FortunaPanel - File Manager Page
import { api } from '../api.js';
import { showToast, escapeHtml } from '../app.js';

let currentPath = '';
let serverId = null;
let editingFile = null;

export function breadcrumbs(params) {
    return [
        { label: 'Dashboard', href: '/' },
        { label: 'Server', href: `/server/${params.id}` },
        { label: 'Files', href: `/server/${params.id}/files` }
    ];
}

export async function render(container, params) {
    serverId = params.id;
    currentPath = '';
    editingFile = null;
    renderLayout(container);
    await loadDirectory(container);
}

function renderLayout(container) {
    container.innerHTML = `
        <div class="mb-5 flex items-center justify-between">
            <h1 class="page-title">File Manager</h1>
        </div>
        <div id="breadcrumbPath" class="mb-4 font-mono text-xs text-muted-foreground"></div>
        <div class="grid min-h-[400px] grid-cols-1 gap-4 md:h-[calc(100vh-220px)] md:grid-cols-2">
            <div class="overflow-y-auto rounded-lg border border-border bg-card" id="fileList"></div>
            <div class="flex flex-col rounded-lg border border-border bg-card" id="editorPanel">
                <div class="m-auto p-4 text-center text-muted-foreground">
                    Select a file to edit
                </div>
            </div>
        </div>
    `;
}

async function loadDirectory(container) {
    const fileList = container.querySelector('#fileList');
    fileList.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const data = await api.get(`/servers/${serverId}/files?path=${encodeURIComponent(currentPath)}`);

        // Update breadcrumb
        const breadcrumb = container.querySelector('#breadcrumbPath');
        const parts = currentPath ? currentPath.split(/[/\\]/) : [];
        breadcrumb.innerHTML = `<span class="cursor-pointer text-foreground hover:text-white" data-nav="">/ root</span>` +
            parts.map((p, i) => {
                const navPath = parts.slice(0, i + 1).join('/');
                return ` / <span class="cursor-pointer text-foreground hover:text-white" data-nav="${escapeHtml(navPath)}">${escapeHtml(p)}</span>`;
            }).join('');

        breadcrumb.querySelectorAll('[data-nav]').forEach(el => {
            el.addEventListener('click', () => {
                currentPath = el.dataset.nav;
                loadDirectory(container);
            });
        });

        // Render file list
        let html = '';
        if (currentPath) {
            html += `<div class="file-item" data-dir="..">
                <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                <span class="file-name">..</span>
            </div>`;
        }

        for (const file of data.files) {
            const icon = file.type === 'directory'
                ? '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
                : '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

            const size = file.type === 'file' ? formatSize(file.size) : '';

            html += `<div class="file-item" data-${file.type}="${escapeHtml(file.name)}">
                ${icon}
                <span class="file-name">${escapeHtml(file.name)}</span>
                <span class="file-size">${escapeHtml(size)}</span>
            </div>`;
        }

        if (data.files.length === 0 && !currentPath) {
            html = '<div class="p-5 text-center text-muted-foreground">Empty directory</div>';
        }

        fileList.innerHTML = html;

        // Wire navigation
        fileList.querySelectorAll('[data-dir]').forEach(el => {
            el.addEventListener('click', () => {
                const dir = el.dataset.dir;
                if (dir === '..') {
                    const parts = currentPath.split(/[/\\]/);
                    parts.pop();
                    currentPath = parts.join('/');
                } else {
                    currentPath = currentPath ? `${currentPath}/${dir}` : dir;
                }
                loadDirectory(container);
            });
        });

        fileList.querySelectorAll('[data-directory]').forEach(el => {
            el.addEventListener('click', () => {
                const dir = el.dataset.directory;
                currentPath = currentPath ? `${currentPath}/${dir}` : dir;
                loadDirectory(container);
            });
        });

        // Wire file opening
        fileList.querySelectorAll('[data-file]').forEach(el => {
            el.addEventListener('click', () => {
                const fileName = el.dataset.file;
                const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
                openFile(container, filePath, fileName);
            });
        });

    } catch (e) {
        fileList.innerHTML = `<div class="p-5 text-sm text-foreground">${escapeHtml(e.message)}</div>`;
    }
}

async function openFile(container, filePath, fileName) {
    const editor = container.querySelector('#editorPanel');
    editor.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

    try {
        const data = await api.get(`/servers/${serverId}/files/read?path=${encodeURIComponent(filePath)}`);
        editingFile = filePath;

        editor.innerHTML = `
            <div class="editor-header">
                <span>${escapeHtml(fileName)}</span>
                <button class="btn btn-sm btn-primary" id="saveFileBtn">Save</button>
            </div>
            <textarea class="editor-textarea" id="fileEditor" spellcheck="false">${escapeHtml(data.content)}</textarea>
        `;

        // Save
        editor.querySelector('#saveFileBtn').addEventListener('click', async () => {
            const content = editor.querySelector('#fileEditor').value;
            try {
                await api.put(`/servers/${serverId}/files/write?path=${encodeURIComponent(filePath)}`, { content });
                showToast('File saved', 'success');
            } catch (e) {
                showToast('Failed to save: ' + e.message, 'error');
            }
        });

        // Ctrl+S save
        editor.querySelector('#fileEditor').addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                editor.querySelector('#saveFileBtn').click();
            }
        });
    } catch (e) {
        editor.innerHTML = `<div class="p-5 text-sm text-foreground">${escapeHtml(e.message)}</div>`;
    }
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

export function destroy() {
    currentPath = '';
    serverId = null;
    editingFile = null;
}

