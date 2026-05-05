const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/health/network/:networkId - Get health status for all backends in a network
router.get('/network/:networkId', requirePermission('server.console'), (req, res) => {
    const healthMonitor = req.app.locals.healthMonitor;
    if (!healthMonitor) return res.status(503).json({ error: 'Health monitor not available' });

    try {
        const health = healthMonitor.getNetworkHealth(req.params.networkId);
        res.json({ servers: health });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/health/server/:serverId - Get health status for a single server
router.get('/server/:serverId', requirePermission('server.console'), (req, res) => {
    const healthMonitor = req.app.locals.healthMonitor;
    if (!healthMonitor) return res.status(503).json({ error: 'Health monitor not available' });

    try {
        const health = healthMonitor.getHealth(req.params.serverId);
        res.json(health);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
