const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { safeFilename } = require('../utils/validation');

const router = express.Router();
router.use(authMiddleware);

// Per-server backup cooldown. Creating a zip of a 5GB world is heavy, so we
// cap at 1 kickoff per server per 30s to block both accidental double-clicks
// and malicious spam that could fill the disk.
const BACKUP_COOLDOWN_MS = parseInt(process.env.BACKUP_COOLDOWN_MS || '30000', 10);
const lastBackupAt = new Map(); // serverId -> timestamp
function checkBackupCooldown(serverId) {
    const now = Date.now();
    const last = lastBackupAt.get(serverId) || 0;
    const remaining = BACKUP_COOLDOWN_MS - (now - last);
    if (remaining > 0) return { blocked: true, retryAfterMs: remaining };
    lastBackupAt.set(serverId, now);
    // Cheap eviction: if the map grows too large, drop old entries.
    if (lastBackupAt.size > 1000) {
        for (const [id, t] of lastBackupAt) {
            if (now - t > BACKUP_COOLDOWN_MS * 4) lastBackupAt.delete(id);
        }
    }
    return { blocked: false };
}

// GET /api/servers/:id/backups - List backups for a server
router.get('/:id/backups', requirePermission('backup.create'), (req, res) => {
    const backupManager = req.app.locals.backupManager;
    if (!backupManager) return res.status(503).json({ error: 'Backup manager not available' });

    const backups = backupManager.listBackups(req.params.id);
    res.json({ backups });
});

// POST /api/servers/:id/backups - Create a backup
router.post('/:id/backups', requirePermission('backup.create'), async (req, res) => {
    const backupManager = req.app.locals.backupManager;
    const serverManager = req.app.locals.serverManager;
    const jobManager = req.app.locals.jobManager;
    if (!backupManager) return res.status(503).json({ error: 'Backup manager not available' });

    const server = serverManager.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const cooldown = checkBackupCooldown(req.params.id);
    if (cooldown.blocked) {
        res.setHeader('Retry-After', Math.ceil(cooldown.retryAfterMs / 1000));
        return res.status(429).json({
            error: 'Backup started too recently, please wait',
            retryAfterMs: cooldown.retryAfterMs
        });
    }

    const asyncMode = req.query.async === '1' || req.body?.async === true;
    if (asyncMode && jobManager) {
        const job = jobManager.createJob({
            type: 'backup.create',
            name: `Create backup: ${server.name}`,
            meta: { serverId: req.params.id, serverName: server.name },
            maxRetries: 1,
            run: async (ctx) => backupManager.createBackup(server, req.user?.username || 'admin', (p, m) => ctx.update(p, m))
        });
        return res.status(202).json({ jobId: job.id, status: job.status });
    }

    try {
        const backup = await backupManager.createBackup(server, req.user?.username || 'admin');
        res.json(backup);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/servers/:id/backups/restore - Restore from a backup
router.post('/:id/backups/restore', requirePermission('backup.restore'), async (req, res) => {
    const backupManager = req.app.locals.backupManager;
    const serverManager = req.app.locals.serverManager;
    const jobManager = req.app.locals.jobManager;
    if (!backupManager) return res.status(503).json({ error: 'Backup manager not available' });

    const server = serverManager.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    let filename;
    try {
        filename = safeFilename(req.body?.filename, 'filename');
    } catch (e) {
        return res.status(e.status || 400).json({ error: e.message });
    }

    const asyncMode = req.query.async === '1' || req.body?.async === true;
    if (asyncMode && jobManager) {
        const job = jobManager.createJob({
            type: 'backup.restore',
            name: `Restore backup: ${server.name}`,
            meta: { serverId: req.params.id, filename },
            maxRetries: 0,
            run: async (ctx) => backupManager.restoreBackup(server, filename, req.user?.username || 'admin', (p, m) => ctx.update(p, m))
        });
        return res.status(202).json({ jobId: job.id, status: job.status });
    }

    try {
        const result = await backupManager.restoreBackup(server, filename, req.user?.username || 'admin');
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/servers/:id/backups/:filename - Delete a backup
router.delete('/:id/backups/:filename', requirePermission('backup.delete'), (req, res) => {
    const backupManager = req.app.locals.backupManager;
    if (!backupManager) return res.status(503).json({ error: 'Backup manager not available' });

    let filename;
    try {
        filename = safeFilename(req.params.filename, 'filename');
    } catch (e) {
        return res.status(e.status || 400).json({ error: e.message });
    }

    try {
        backupManager.deleteBackup(req.params.id, filename, req.user?.username || 'admin');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
