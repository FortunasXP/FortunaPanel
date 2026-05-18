const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');

const router = express.Router();
router.use(authMiddleware);

// GET /api/proxy/routes - List all proxy routes
router.get('/routes', requireGlobalPermission('panel.read'), (req, res) => {
    const proxyManager = req.app.locals.proxyManager;
    res.json(proxyManager.listRoutes());
});

// POST /api/proxy/routes - Create a new proxy route
router.post('/routes', requireGlobalPermission('panel.settings'), (req, res) => {
    const proxyManager = req.app.locals.proxyManager;
    const { name, listenPort, targetHost, targetPort, serverId, enabled } = req.body;

    if (!listenPort || !targetPort) {
        return res.status(400).json({ error: 'listenPort and targetPort are required' });
    }

    try {
        const route = proxyManager.addRoute({ name, listenPort, targetHost, targetPort, serverId, enabled });
        res.status(201).json(route);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PUT /api/proxy/routes/:id - Update a proxy route
router.put('/routes/:id', requireGlobalPermission('panel.settings'), (req, res) => {
    const proxyManager = req.app.locals.proxyManager;
    const { name, listenPort, targetHost, targetPort, serverId, enabled } = req.body;
    try {
        const route = proxyManager.updateRoute(req.params.id, { name, listenPort, targetHost, targetPort, serverId, enabled });
        res.json(route);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/proxy/routes/:id - Delete a proxy route
router.delete('/routes/:id', requireGlobalPermission('panel.settings'), (req, res) => {
    const proxyManager = req.app.locals.proxyManager;
    try {
        proxyManager.deleteRoute(req.params.id);
        res.json({ message: 'Route deleted' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// GET /api/proxy/ssl - Get SSL status
router.get('/ssl', requireGlobalPermission('panel.read'), (req, res) => {
    const sslManager = req.app.locals.sslManager;
    res.json(sslManager.getStatus());
});

// POST /api/proxy/ssl/custom - Upload custom SSL certificate
router.post('/ssl/custom', requireGlobalPermission('panel.settings'), (req, res) => {
    const sslManager = req.app.locals.sslManager;
    const { cert, key, ca } = req.body;
    if (!cert || !key) {
        return res.status(400).json({ error: 'Certificate and private key are required' });
    }
    try {
        const status = sslManager.setCustomCert({ cert, key, ca });
        res.json(status);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/proxy/ssl/auto - Enable automatic Let's Encrypt SSL
router.post('/ssl/auto', requireGlobalPermission('panel.settings'), asyncRoute(async (req, res) => {
    const sslManager = req.app.locals.sslManager;
    const { domain, email } = req.body;
    if (!domain || !email) {
        return res.status(400).json({ error: 'Domain and email are required' });
    }
    const status = await sslManager.enableAutoSSL(domain, email);
    res.json(status);
}));

// POST /api/proxy/ssl/disable - Disable SSL
router.post('/ssl/disable', requireGlobalPermission('panel.settings'), (req, res) => {
    const sslManager = req.app.locals.sslManager;
    const status = sslManager.disable();
    res.json(status);
});

module.exports = router;
