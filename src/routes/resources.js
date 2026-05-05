// FortunaPanel - Resource Limits Routes
const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getLimiter(req) {
    return req.app.locals.resourceLimiter;
}
function getManager(req) {
    return req.app.locals.serverManager;
}

// GET /api/resources - Get all server resource usage summary
router.get('/', requirePermission('server.console'), (req, res) => {
    const limiter = getLimiter(req);
    res.json({ servers: limiter.getSummary() });
});

// GET /api/resources/:serverId - Get specific server resource usage
router.get('/:serverId', requirePermission('server.console'), (req, res) => {
    const limiter = getLimiter(req);
    const manager = getManager(req);
    const instance = manager.getServer(req.params.serverId);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    res.json({
        serverId: req.params.serverId,
        serverName: instance.name,
        limits: limiter.getLimits(req.params.serverId),
        usage: limiter.getUsage(req.params.serverId)
    });
});

// PUT /api/resources/:serverId - Set resource limits for a server
router.put('/:serverId', requirePermission('server.settings'), (req, res) => {
    const limiter = getLimiter(req);
    const manager = getManager(req);
    const instance = manager.getServer(req.params.serverId);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const { cpuPercent, memoryMB, diskMB } = req.body;

    limiter.setLimits(req.params.serverId, {
        cpuPercent: parseInt(cpuPercent) || 0,
        memoryMB: parseInt(memoryMB) || 0,
        diskMB: parseInt(diskMB) || 0
    });

    // Also store limits in server config for persistence
    instance.config.resourceLimits = {
        cpuPercent: parseInt(cpuPercent) || 0,
        memoryMB: parseInt(memoryMB) || 0,
        diskMB: parseInt(diskMB) || 0
    };
    manager.saveRegistry();

    res.json({ success: true, limits: limiter.getLimits(req.params.serverId) });
});

module.exports = router;
