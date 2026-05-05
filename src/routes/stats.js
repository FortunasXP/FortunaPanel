const express = require('express');
const { authMiddleware, requireGlobalPermission, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/stats - Get system stats snapshot
router.get('/', requireGlobalPermission('panel.read'), (req, res) => {
    const monitor = req.app.locals.systemMonitor;
    if (!monitor) {
        return res.status(503).json({ error: 'System monitor not available' });
    }
    res.json(monitor.getSnapshot());
});

// GET /api/stats/server/:id - Get per-server stats
router.get('/server/:id', requirePermission('server.console'), (req, res) => {
    const monitor = req.app.locals.systemMonitor;
    if (!monitor) {
        return res.status(503).json({ error: 'System monitor not available' });
    }
    res.json(monitor.getServerStats(req.params.id));
});

// GET /api/stats/server/:id/history - Get historical stats
router.get('/server/:id/history', requirePermission('server.console'), (req, res) => {
    const statsCollector = req.app.locals.statsCollector;
    if (!statsCollector) {
        return res.status(503).json({ error: 'Stats collector not available' });
    }
    const range = req.query.range || '24h';
    if (!['24h', '7d', '30d'].includes(range)) {
        return res.status(400).json({ error: 'Invalid range. Use 24h, 7d, or 30d' });
    }
    res.json(statsCollector.getHistory(req.params.id, range));
});

module.exports = router;
