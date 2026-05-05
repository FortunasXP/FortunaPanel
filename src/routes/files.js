const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');
const { parse, stringify, PROPERTY_METADATA } = require('../utils/propertiesParser');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.serverManager;
}

function getServerDir(req) {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return null;
    return instance.config.directory;
}

function safePath(serverDir, requestedPath) {
    const resolved = path.resolve(serverDir, requestedPath || '');
    if (!resolved.startsWith(serverDir)) return null;
    return resolved;
}

// GET /api/servers/:id/files?path=
router.get('/:id/files', requirePermission('file.read'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const targetPath = safePath(serverDir, req.query.path || '');
    if (!targetPath) return res.status(403).json({ error: 'Invalid path' });

    let stat;
    try {
        stat = await fsp.stat(targetPath);
    } catch {
        return res.status(404).json({ error: 'Path not found' });
    }

    if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Not a directory' });
    }

    const names = await fsp.readdir(targetPath);
    const entries = await Promise.all(names.map(async (name) => {
        const fullPath = path.join(targetPath, name);
        try {
            const s = await fsp.stat(fullPath);
            return {
                name,
                type: s.isDirectory() ? 'directory' : 'file',
                size: s.size,
                modified: s.mtime.toISOString()
            };
        } catch {
            return { name, type: 'file', size: 0, modified: null };
        }
    }));

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    res.json({ path: req.query.path || '', files: entries });
}));

// GET /api/servers/:id/files/read?path=
router.get('/:id/files/read', requirePermission('file.read'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const targetPath = safePath(serverDir, req.query.path);
    if (!targetPath) return res.status(403).json({ error: 'Invalid path' });

    let stat;
    try {
        stat = await fsp.stat(targetPath);
    } catch {
        return res.status(404).json({ error: 'File not found' });
    }

    if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot read a directory' });
    }
    if (stat.size > 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (max 1MB)' });
    }

    const content = await fsp.readFile(targetPath, 'utf-8');
    res.json({ content, path: req.query.path });
}));

// PUT /api/servers/:id/files/write?path=
router.put('/:id/files/write', requirePermission('file.write'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const targetPath = safePath(serverDir, req.query.path);
    if (!targetPath) return res.status(403).json({ error: 'Invalid path' });
    if (!req.query.path) return res.status(400).json({ error: 'File path required' });

    // Prevent writing to a directory
    try {
        const stat = await fsp.stat(targetPath);
        if (stat.isDirectory()) {
            return res.status(400).json({ error: 'Cannot write to a directory' });
        }
    } catch {
        // File doesn't exist yet — that's fine
    }

    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'Content required' });

    // Ensure parent directory exists
    const parentDir = path.dirname(targetPath);
    await fsp.mkdir(parentDir, { recursive: true });

    await fsp.writeFile(targetPath, content);
    res.json({ success: true });
}));

// DELETE /api/servers/:id/files?path=
router.delete('/:id/files', requirePermission('file.delete'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const targetPath = safePath(serverDir, req.query.path);
    if (!targetPath) return res.status(403).json({ error: 'Invalid path' });
    if (targetPath === serverDir) return res.status(403).json({ error: 'Cannot delete server root' });

    let stat;
    try {
        stat = await fsp.stat(targetPath);
    } catch {
        return res.status(404).json({ error: 'File not found' });
    }

    if (stat.isDirectory()) {
        await fsp.rm(targetPath, { recursive: true });
    } else {
        await fsp.unlink(targetPath);
    }

    res.json({ success: true });
}));

// GET /api/servers/:id/properties
router.get('/:id/properties', requirePermission('server.properties'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const propsPath = path.join(serverDir, 'server.properties');
    try {
        const content = await fsp.readFile(propsPath, 'utf-8');
        const properties = parse(content);
        res.json({ properties, metadata: PROPERTY_METADATA });
    } catch (e) {
        if (e.code === 'ENOENT') {
            return res.json({ properties: {}, metadata: PROPERTY_METADATA });
        }
        throw e;
    }
}));

// PUT /api/servers/:id/properties
router.put('/:id/properties', requirePermission('server.properties'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const { properties } = req.body;
    if (!properties) return res.status(400).json({ error: 'Properties required' });

    const propsPath = path.join(serverDir, 'server.properties');
    let originalContent = '';
    try {
        originalContent = await fsp.readFile(propsPath, 'utf-8');
    } catch {
        // File doesn't exist yet — start from empty
    }

    const content = stringify(properties, originalContent);
    await fsp.writeFile(propsPath, content);
    res.json({ success: true });
}));

// GET /api/servers/:id/config-files - List available config files
const KNOWN_CONFIG_FILES = [
    { file: 'bukkit.yml', label: 'Bukkit', type: 'yaml', types: ['paper', 'spigot'] },
    { file: 'spigot.yml', label: 'Spigot', type: 'yaml', types: ['paper', 'spigot'] },
    { file: 'config/paper-global.yml', label: 'Paper Global', type: 'yaml', types: ['paper'] },
    { file: 'config/paper-world-defaults.yml', label: 'Paper World Defaults', type: 'yaml', types: ['paper'] },
    { file: 'paper.yml', label: 'Paper (Legacy)', type: 'yaml', types: ['paper'] },
    { file: 'velocity.toml', label: 'Velocity', type: 'toml', types: ['velocity'] },
    { file: 'config.yml', label: 'BungeeCord Config', type: 'yaml', types: ['bungeecord'] },
    { file: 'server.properties', label: 'Server Properties', type: 'properties', types: ['paper', 'spigot', 'vanilla'] },
    { file: 'ops.json', label: 'Operators', type: 'json', types: ['paper', 'spigot', 'vanilla'] },
    { file: 'whitelist.json', label: 'Whitelist', type: 'json', types: ['paper', 'spigot', 'vanilla'] }
];

router.get('/:id/config-files', requirePermission('file.read'), asyncRoute(async (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    const serverType = instance?.config?.type || 'vanilla';

    const available = [];
    for (const cf of KNOWN_CONFIG_FILES) {
        const filePath = path.join(serverDir, cf.file);
        try {
            await fsp.access(filePath);
            available.push({ ...cf, recommended: cf.types.includes(serverType) });
        } catch {
            // File doesn't exist — skip
        }
    }

    res.json(available);
}));

module.exports = router;
