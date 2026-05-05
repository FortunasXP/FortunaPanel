const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.networkManager;
}

function getServerManager(req) {
    return req.app.locals.serverManager;
}

function getActivityLog(req) {
    return req.app.locals.activityLog;
}

// GET /api/networks - List all networks
router.get('/', requirePermission('server.console'), (req, res) => {
    try {
        const manager = getManager(req);
        const networks = manager.getAllNetworks().map(net => {
            try {
                return manager.getNetworkDetail(net.id);
            } catch (e) {
                return { ...net, proxy: { status: 'unknown', missing: true }, backends: [], error: e.message };
            }
        }).filter(Boolean);
        res.json(networks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/networks/:id - Get network detail
router.get('/:id', requirePermission('server.console'), (req, res) => {
    try {
        const manager = getManager(req);
        const detail = manager.getNetworkDetail(req.params.id);
        if (!detail) return res.status(404).json({ error: 'Network not found' });
        res.json(detail);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/networks - Create network
router.post('/', requirePermission('server.settings'), async (req, res) => {
    try {
        const { name, proxyId, proxyType } = req.body;
        if (!proxyId) return res.status(400).json({ error: 'proxyId is required' });

        const manager = getManager(req);
        const network = await manager.createNetwork({ name, proxyId, proxyType });

        getActivityLog(req).log('network.create', {
            networkId: network.id,
            networkName: network.name,
            proxyId
        });

        res.status(201).json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/networks/:id - Delete network
router.delete('/:id', requirePermission('server.delete'), async (req, res) => {
    try {
        const manager = getManager(req);
        const network = manager.getNetwork(req.params.id);
        if (!network) return res.status(404).json({ error: 'Network not found' });

        const name = network.name;
        await manager.deleteNetwork(req.params.id);

        getActivityLog(req).log('network.delete', {
            networkId: req.params.id,
            networkName: name
        });

        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /api/networks/:id - Update network
router.patch('/:id', requirePermission('server.settings'), async (req, res) => {
    try {
        const manager = getManager(req);
        const { name, forwardingMode, defaultServer, bootOrder, healthCheck } = req.body;
        const network = await manager.updateNetwork(req.params.id, { name, forwardingMode, defaultServer, bootOrder, healthCheck });

        getActivityLog(req).log('network.update', {
            networkId: network.id,
            networkName: network.name
        });

        res.json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/backends - Add backend server
router.post('/:id/backends', requirePermission('server.settings'), async (req, res) => {
    try {
        const { serverId, alias } = req.body;
        if (!serverId) return res.status(400).json({ error: 'serverId is required' });

        const manager = getManager(req);
        const serverManager = getServerManager(req);
        const backend = serverManager.getServer(serverId);

        const network = await manager.addBackend(req.params.id, serverId, alias);

        getActivityLog(req).log('network.backend-add', {
            networkId: network.id,
            networkName: network.name,
            serverId,
            serverName: backend?.name,
            alias: network.backendAliases[serverId]
        });

        res.json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/networks/:id/backends/:serverId - Remove backend server
router.delete('/:id/backends/:serverId', requirePermission('server.settings'), async (req, res) => {
    try {
        const manager = getManager(req);
        const serverManager = getServerManager(req);
        const backend = serverManager.getServer(req.params.serverId);

        const network = await manager.removeBackend(req.params.id, req.params.serverId);

        getActivityLog(req).log('network.backend-remove', {
            networkId: network.id,
            networkName: network.name,
            serverId: req.params.serverId,
            serverName: backend?.name
        });

        res.json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH /api/networks/:id/backends/:serverId - Update backend alias
router.patch('/:id/backends/:serverId', requirePermission('server.settings'), async (req, res) => {
    try {
        const manager = getManager(req);
        const network = manager.getNetwork(req.params.id);
        if (!network) return res.status(404).json({ error: 'Network not found' });

        const { alias } = req.body;
        if (!alias) return res.status(400).json({ error: 'alias is required' });

        const idx = network.backendIds.indexOf(req.params.serverId);
        if (idx === -1) return res.status(404).json({ error: 'Server not in this network' });

        // Check alias uniqueness
        const safeAlias = alias.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const existing = Object.entries(network.backendAliases)
            .find(([id, a]) => a === safeAlias && id !== req.params.serverId);
        if (existing) return res.status(400).json({ error: `Alias "${safeAlias}" is already used` });

        network.backendAliases[req.params.serverId] = safeAlias;
        network.updatedAt = new Date().toISOString();

        await manager.syncProxyConfig(req.params.id);
        await manager.saveRegistry();

        res.json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/sync - Force re-sync all configs
router.post('/:id/sync', requirePermission('server.settings'), async (req, res) => {
    try {
        const manager = getManager(req);
        await manager.syncAllConfigs(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/secret - Regenerate forwarding secret
router.post('/:id/secret', requirePermission('server.settings'), async (req, res) => {
    try {
        const manager = getManager(req);
        const network = await manager.regenerateSecret(req.params.id);
        res.json({ success: true, forwardingSecret: network.forwardingSecret });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/start - Start entire network
router.post('/:id/start', requirePermission('server.start'), async (req, res) => {
    try {
        const manager = getManager(req);
        const network = manager.getNetwork(req.params.id);
        if (!network) return res.status(404).json({ error: 'Network not found' });

        await manager.startNetwork(req.params.id);

        getActivityLog(req).log('network.start', {
            networkId: network.id,
            networkName: network.name
        });

        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/stop - Stop entire network
router.post('/:id/stop', requirePermission('server.stop'), async (req, res) => {
    try {
        const manager = getManager(req);
        const network = manager.getNetwork(req.params.id);
        if (!network) return res.status(404).json({ error: 'Network not found' });

        await manager.stopNetwork(req.params.id);

        getActivityLog(req).log('network.stop', {
            networkId: network.id,
            networkName: network.name
        });

        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/rolling-restart - Trigger rolling restart
router.post('/:id/rolling-restart', requirePermission('server.start'), async (req, res) => {
    try {
        const manager = getManager(req);
        const jobManager = req.app.locals.jobManager;
        const network = manager.getNetwork(req.params.id);
        if (!network) return res.status(404).json({ error: 'Network not found' });

        const asyncMode = req.query.async !== '0';
        if (asyncMode && jobManager) {
            const job = jobManager.createJob({
                type: 'network.rolling_restart',
                name: `Rolling restart: ${network.name}`,
                meta: { networkId: network.id, networkName: network.name },
                maxRetries: 0,
                run: async (ctx) => {
                    ctx.update(5, 'Starting rolling restart');
                    await manager.rollingRestart(req.params.id);
                    ctx.update(100, 'Rolling restart completed');
                    return { success: true };
                }
            });

            getActivityLog(req).log('network.rolling-restart', {
                networkId: network.id,
                networkName: network.name,
                jobId: job.id
            });

            return res.status(202).json({ success: true, jobId: job.id, message: 'Rolling restart queued' });
        }

        // Compatibility path: run async fire-and-forget
        manager.rollingRestart(req.params.id).catch(err => {
            const logger = require('../utils/logger');
            logger.error(`Rolling restart failed for ${network.name}: ${err.message}`);
        });

        getActivityLog(req).log('network.rolling-restart', {
            networkId: network.id,
            networkName: network.name
        });

        res.json({ success: true, message: 'Rolling restart initiated' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/maintenance/:serverId - Toggle maintenance mode
router.post('/:id/maintenance/:serverId', requirePermission('server.settings'), async (req, res) => {
    try {
        const manager = getManager(req);
        const { enabled, reason } = req.body;

        const network = await manager.setMaintenanceMode(req.params.id, req.params.serverId, enabled, reason);

        getActivityLog(req).log('network.maintenance', {
            networkId: network.id,
            networkName: network.name,
            serverId: req.params.serverId,
            enabled,
            reason
        });

        res.json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/networks/:id/default - Set default server
router.post('/:id/default', requirePermission('server.settings'), async (req, res) => {
    try {
        const { serverId } = req.body;
        if (!serverId) return res.status(400).json({ error: 'serverId is required' });

        const manager = getManager(req);
        const network = await manager.setDefaultServer(req.params.id, serverId);
        res.json(network);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
