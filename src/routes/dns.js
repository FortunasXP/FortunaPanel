const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getDnsManager(req) {
    return req.app.locals.dnsManager;
}

// ==================== Provider CRUD ====================

// GET /api/dns/providers - List all providers (credentials masked)
router.get('/providers', requirePermission('server.settings'), (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });
    res.json(dm.getProviders());
});

// POST /api/dns/providers - Add a new provider
router.post('/providers', requirePermission('server.settings'), (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    const { name, type, credentials } = req.body;
    if (!name || !type || !credentials) {
        return res.status(400).json({ error: 'name, type, and credentials are required' });
    }
    if (!['cloudflare', 'route53'].includes(type)) {
        return res.status(400).json({ error: 'type must be cloudflare or route53' });
    }

    try {
        const provider = dm.addProvider({ name, type, credentials });
        res.status(201).json(provider);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PUT /api/dns/providers/:id - Update a provider
router.put('/providers/:id', requirePermission('server.settings'), (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        const provider = dm.updateProvider(req.params.id, req.body);
        res.json(provider);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/dns/providers/:id - Remove a provider
router.delete('/providers/:id', requirePermission('server.settings'), (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        dm.removeProvider(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/dns/providers/:id/test - Test connectivity
router.post('/providers/:id/test', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        const result = await dm.testProvider(req.params.id);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ==================== Network DNS ====================

// POST /api/dns/networks/:networkId - Configure DNS for a network
router.post('/networks/:networkId', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    const { providerId, baseDomain, serverIp, autoSync } = req.body;
    if (!providerId || !baseDomain || !serverIp) {
        return res.status(400).json({ error: 'providerId, baseDomain, and serverIp are required' });
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(baseDomain)) {
        return res.status(400).json({ error: 'Invalid domain name format' });
    }
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(serverIp)) {
        return res.status(400).json({ error: 'Invalid IP address format' });
    }

    try {
        const dns = await dm.configureNetworkDns(req.params.networkId, { providerId, baseDomain, serverIp, autoSync });
        res.json(dns);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/dns/networks/:networkId - Remove DNS from a network
router.delete('/networks/:networkId', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        await dm.removeNetworkDns(req.params.networkId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/dns/networks/:networkId/sync - Force sync DNS records
router.post('/networks/:networkId/sync', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        await dm.syncNetworkDns(req.params.networkId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/dns/networks/:networkId/forced-hosts - Add a forced host
router.post('/networks/:networkId/forced-hosts', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    const { serverId, subdomain } = req.body;
    if (!serverId || !subdomain) {
        return res.status(400).json({ error: 'serverId and subdomain are required' });
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(subdomain)) {
        return res.status(400).json({ error: 'Invalid subdomain format. Use letters, numbers, and hyphens only.' });
    }

    try {
        const dns = await dm.addForcedHost(req.params.networkId, serverId, subdomain);
        res.json(dns);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/dns/networks/:networkId/forced-hosts/:serverId - Remove a forced host
router.delete('/networks/:networkId/forced-hosts/:serverId', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        await dm.removeForcedHost(req.params.networkId, req.params.serverId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ==================== Per-Server DNS ====================

// POST /api/dns/servers/:serverId - Configure DNS for a single (non-network) server
router.post('/servers/:serverId', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    const { providerId, domain, serverIp, autoSync } = req.body;
    if (!providerId || !domain || !serverIp) {
        return res.status(400).json({ error: 'providerId, domain, and serverIp are required' });
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain)) {
        return res.status(400).json({ error: 'Invalid domain name format' });
    }
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(serverIp)) {
        return res.status(400).json({ error: 'Invalid IP address format' });
    }

    try {
        const dns = await dm.configureServerDns(req.params.serverId, { providerId, domain, serverIp, autoSync });
        res.json(dns);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/dns/servers/:serverId - Remove DNS from a server
router.delete('/servers/:serverId', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        await dm.removeServerDns(req.params.serverId);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/dns/servers/:serverId/sync - Force sync DNS records for a server
router.post('/servers/:serverId/sync', requirePermission('server.settings'), async (req, res) => {
    const dm = getDnsManager(req);
    if (!dm) return res.status(503).json({ error: 'DNS manager not available' });

    try {
        const dns = await dm.syncServerDns(req.params.serverId);
        res.json(dns);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
