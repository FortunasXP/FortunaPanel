const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');

const router = express.Router();
router.use(authMiddleware);

// GET /api/servers/:id/snapshots - List all snapshots for a server
router.get('/:id/snapshots', requirePermission('server.backup'), asyncRoute(async (req, res) => {
    const snapshotManager = req.app.locals.snapshotManager;
    const snapshots = snapshotManager.listSnapshots(req.params.id);
    const usage = snapshotManager.getDiskUsage(req.params.id);
    res.json({ snapshots, ...usage });
}));

// POST /api/servers/:id/snapshots - Create a new snapshot
router.post('/:id/snapshots', requirePermission('server.backup'), asyncRoute(async (req, res) => {
    const snapshotManager = req.app.locals.snapshotManager;
    const { name, description } = req.body;

    const snapshot = await snapshotManager.createSnapshot(req.params.id, {
        name: name || undefined,
        description: description || '',
        user: req.user.username
    });

    res.status(201).json(snapshot);
}));

// POST /api/servers/:id/snapshots/:snapshotId/restore - Restore a snapshot
router.post('/:id/snapshots/:snapshotId/restore', requirePermission('server.backup'), asyncRoute(async (req, res) => {
    const snapshotManager = req.app.locals.snapshotManager;

    const snapshot = await snapshotManager.restoreSnapshot(
        req.params.id,
        req.params.snapshotId,
        { user: req.user.username }
    );

    res.json({ message: 'Snapshot restored successfully', snapshot });
}));

// GET /api/servers/:id/snapshots/:snapshotId/download - Download snapshot archive
router.get('/:id/snapshots/:snapshotId/download', requirePermission('server.backup'), (req, res) => {
    const snapshotManager = req.app.locals.snapshotManager;
    const archivePath = snapshotManager.getArchivePath(req.params.id, req.params.snapshotId);

    if (!archivePath) {
        return res.status(404).json({ error: 'Snapshot not found' });
    }

    const snapshot = snapshotManager.getSnapshot(req.params.id, req.params.snapshotId);
    const safeName = (snapshot?.name || 'snapshot').replace(/[^a-zA-Z0-9-_ ]/g, '');
    res.download(archivePath, `${safeName}.zip`);
});

// DELETE /api/servers/:id/snapshots/:snapshotId - Delete a snapshot
router.delete('/:id/snapshots/:snapshotId', requirePermission('server.backup'), asyncRoute(async (req, res) => {
    const snapshotManager = req.app.locals.snapshotManager;

    await snapshotManager.deleteSnapshot(
        req.params.id,
        req.params.snapshotId,
        req.user.username
    );

    res.json({ message: 'Snapshot deleted' });
}));

module.exports = router;
