// FortunaPanel - Console Log Routes
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config/default');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');
const { safeUuid, safeFilename, pathInside } = require('../utils/validation');

const router = express.Router();
router.use(authMiddleware);

const LOGS_DIR = path.resolve(path.join(config.dataDir, 'console-logs'));

// Resolve the per-server log directory after validating the server id is a UUID.
// Returns the absolute path (always inside LOGS_DIR) or throws via safeUuid.
function getServerLogDir(serverId) {
    const id = safeUuid(serverId, 'serverId');
    return path.resolve(LOGS_DIR, id);
}

// GET /api/servers/:id/logs - List log files
router.get('/:id/logs', requirePermission('server.command'), asyncRoute(async (req, res) => {
    const serverLogDir = getServerLogDir(req.params.id);

    let fileNames;
    try {
        fileNames = await fsp.readdir(serverLogDir);
    } catch {
        return res.json({ logs: [] });
    }

    const logFiles = fileNames.filter(f => f.endsWith('.log'));
    const logs = await Promise.all(logFiles.map(async (f) => {
        try {
            const stat = await fsp.stat(path.join(serverLogDir, f));
            return {
                filename: f,
                size: stat.size,
                date: f.replace('.log', ''),
                modified: stat.mtime.toISOString()
            };
        } catch {
            return null;
        }
    }));

    const filtered = logs.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
    res.json({ logs: filtered });
}));

// GET /api/servers/:id/logs-search?q= - Search across log files
// Note: separate path to avoid conflict with /:filename param
router.get('/:id/logs-search', requirePermission('server.command'), asyncRoute(async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const serverLogDir = getServerLogDir(req.params.id);

    let fileNames;
    try {
        fileNames = await fsp.readdir(serverLogDir);
    } catch {
        return res.json({ results: [], total: 0 });
    }

    const results = [];
    const files = fileNames.filter(f => f.endsWith('.log')).sort().reverse();
    const searchLower = q.toLowerCase();
    const MAX_RESULTS = 500;

    for (const file of files) {
        if (results.length >= MAX_RESULTS) break;
        const content = await fsp.readFile(path.join(serverLogDir, file), 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_RESULTS) break;
            if (lines[i].toLowerCase().includes(searchLower)) {
                results.push({
                    file,
                    line: i + 1,
                    text: lines[i].trim()
                });
            }
        }
    }

    res.json({ results, total: results.length, query: q });
}));

// GET /api/servers/:id/logs/:filename - Download a specific log file
router.get('/:id/logs/:filename', requirePermission('server.command'), asyncRoute(async (req, res) => {
    let serverLogDir, filename;
    try {
        serverLogDir = getServerLogDir(req.params.id);
        filename = safeFilename(req.params.filename, 'filename');
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    if (!/\.log$/i.test(filename)) {
        return res.status(400).json({ error: 'Only .log files can be downloaded' });
    }

    const filePath = path.resolve(serverLogDir, filename);
    if (!pathInside(serverLogDir, filePath)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        await fsp.access(filePath);
    } catch {
        return res.status(404).json({ error: 'Log file not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain');
    fs.createReadStream(filePath).pipe(res);
}));

module.exports = router;
