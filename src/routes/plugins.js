const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authMiddleware, requirePermission, requireGlobalPermission } = require('../middleware/auth');
const { pathInside, safeFilename } = require('../utils/validation');

const router = express.Router();
router.use(authMiddleware);

function getServerDir(req) {
    const manager = req.app.locals.serverManager;
    const instance = manager.getServer(req.params.id);
    if (!instance) return null;
    return path.resolve(instance.config.directory);
}

// GET /api/servers/modrinth/search - Search Modrinth for plugins/mods
router.get('/modrinth/search', requireGlobalPermission('plugin.list'), async (req, res) => {
    const { searchPlugins } = require('../services/modrinthApi');
    const { q, version, platform } = req.query;
    try {
        const results = await searchPlugins(q, version, platform);
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: `Search failed: ${err.message}` });
    }
});

// GET /api/servers/modrinth/versions/:projectId - Get project versions
router.get('/modrinth/versions/:projectId', requireGlobalPermission('plugin.list'), async (req, res) => {
    const { getProjectVersions } = require('../services/modrinthApi');
    const { gameVersion, loaders } = req.query;
    try {
        const versions = await getProjectVersions(
            req.params.projectId,
            gameVersion,
            loaders ? loaders.split(',') : undefined
        );
        res.json({ versions });
    } catch (err) {
        res.status(500).json({ error: `Failed to get versions: ${err.message}` });
    }
});

// POST /api/servers/:id/plugins/install-remote - Download and install from Modrinth
router.post('/:id/plugins/install-remote', requirePermission('plugin.install'), async (req, res) => {
    const { downloadPlugin } = require('../services/modrinthApi');
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const { downloadUrl, folder } = req.body;
    let filename;
    try {
        filename = safeFilename(req.body.filename, 'filename');
        if (!/\.jar$/i.test(filename)) {
            return res.status(400).json({ error: 'filename must end with .jar' });
        }
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    if (!downloadUrl) return res.status(400).json({ error: 'downloadUrl required' });

    // SSRF protection: only allow downloads from trusted CDN origins
    const allowedOrigins = [
        'https://cdn.modrinth.com/',
        'https://mediafilez.forgecdn.net/'
    ];
    if (!allowedOrigins.some(origin => downloadUrl.startsWith(origin))) {
        return res.status(400).json({ error: 'Download URL must be from a trusted source (Modrinth or CurseForge CDN)' });
    }

    const targetFolder = folder === 'mods' ? 'mods' : 'plugins';
    const dir = path.resolve(serverDir, targetFolder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const destPath = path.resolve(dir, filename);
    if (!pathInside(dir, destPath)) return res.status(403).json({ error: 'Invalid path' });

    try {
        await downloadPlugin(downloadUrl, destPath);
        const stat = fs.statSync(destPath);

        const activityLog = req.app.locals.activityLog;
        if (activityLog) {
            activityLog.log('plugin.install-remote', {
                serverId: req.params.id,
                filename,
                folder: targetFolder,
                source: 'modrinth',
                size: stat.size
            }, req.user?.username || 'admin');
        }

        res.json({ success: true, filename, size: stat.size, folder: targetFolder });
    } catch (err) {
        res.status(500).json({ error: `Download failed: ${err.message}` });
    }
});

// GET /api/servers/:id/plugins - List plugins/mods
router.get('/:id/plugins', requirePermission('plugin.list'), (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const plugins = [];

    // Check both plugins/ and mods/ directories
    for (const folder of ['plugins', 'mods']) {
        const dir = path.join(serverDir, folder);
        if (!fs.existsSync(dir)) continue;

        const files = fs.readdirSync(dir);
        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (ext !== '.jar' && ext !== '.disabled') continue;

            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            const enabled = ext === '.jar';
            const cleanName = file.replace(/\.(jar|disabled)$/i, '');

            plugins.push({
                name: cleanName,
                filename: file,
                folder,
                enabled,
                size: stat.size,
                modified: stat.mtime.toISOString()
            });
        }
    }

    // Sort by name
    plugins.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ plugins });
});

// POST /api/servers/:id/plugins/toggle - Toggle a plugin enabled/disabled
router.post('/:id/plugins/toggle', requirePermission('plugin.toggle'), (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const { folder } = req.body;
    if (folder !== 'plugins' && folder !== 'mods') {
        return res.status(400).json({ error: 'folder must be "plugins" or "mods"' });
    }
    let filename;
    try {
        filename = safeFilename(req.body.filename, 'filename');
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const dir = path.resolve(serverDir, folder);
    const filePath = path.resolve(dir, filename);

    if (!pathInside(dir, filePath)) return res.status(403).json({ error: 'Invalid path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    let newName;
    if (filename.endsWith('.jar')) {
        newName = filename.replace(/\.jar$/i, '.disabled');
    } else if (filename.endsWith('.disabled')) {
        newName = filename.replace(/\.disabled$/i, '.jar');
    } else {
        return res.status(400).json({ error: 'Not a plugin file' });
    }

    const newPath = path.join(dir, newName);
    fs.renameSync(filePath, newPath);

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('plugin.toggle', {
            serverId: req.params.id,
            filename,
            newFilename: newName,
            enabled: newName.endsWith('.jar')
        }, req.user?.username || 'admin');
    }

    res.json({ success: true, filename: newName, enabled: newName.endsWith('.jar') });
});

// DELETE /api/servers/:id/plugins - Delete a plugin
router.delete('/:id/plugins', requirePermission('plugin.delete'), (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    const { folder } = req.body;
    if (folder !== 'plugins' && folder !== 'mods') {
        return res.status(400).json({ error: 'folder must be "plugins" or "mods"' });
    }
    let filename;
    try {
        filename = safeFilename(req.body.filename, 'filename');
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const dir = path.resolve(serverDir, folder);
    const filePath = path.resolve(dir, filename);

    if (!pathInside(dir, filePath)) return res.status(403).json({ error: 'Invalid path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    fs.unlinkSync(filePath);

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('plugin.delete', {
            serverId: req.params.id,
            filename,
            folder
        }, req.user?.username || 'admin');
    }

    res.json({ success: true });
});

// Upload plugin - configured per-request
router.post('/:id/plugins/upload', requirePermission('plugin.install'), (req, res) => {
    const serverDir = getServerDir(req);
    if (!serverDir) return res.status(404).json({ error: 'Server not found' });

    // Determine target folder from query
    const folder = req.query.folder === 'mods' ? 'mods' : 'plugins';
    const dir = path.resolve(serverDir, folder);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const storage = multer.diskStorage({
        destination: (r, file, cb) => cb(null, dir),
        filename: (r, file, cb) => {
            try {
                // Sanitize: strip any directory components and validate
                const safe = safeFilename(path.basename(file.originalname), 'filename');
                cb(null, safe);
            } catch (e) {
                cb(e);
            }
        }
    });

    const upload = multer({
        storage,
        limits: { fileSize: 200 * 1024 * 1024 },
        fileFilter: (r, file, cb) => {
            const base = path.basename(file.originalname || '');
            if (path.extname(base).toLowerCase() === '.jar') {
                cb(null, true);
            } else {
                cb(new Error('Only .jar files allowed'));
            }
        }
    }).single('file');

    upload(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const activityLog = req.app.locals.activityLog;
        if (activityLog) {
            activityLog.log('plugin.upload', {
                serverId: req.params.id,
                filename: req.file.originalname,
                folder,
                size: req.file.size
            }, req.user?.username || 'admin');
        }

        res.json({ success: true, filename: req.file.originalname, size: req.file.size });
    });
});

module.exports = router;
