// FortunaPanel - API Key Management Routes
const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.apiKeyManager;
}

function isAdminUser(req) {
    const userStore = req.app.locals.userStore;
    const admin = userStore.getAdmin();
    if (!admin?.username) return req.user?.role === 'admin';
    return req.user?.username === admin.username || req.user?.role === 'admin';
}

// GET /api/keys - List all API keys
router.get('/', requireGlobalPermission('panel.keys'), (req, res) => {
    const manager = getManager(req);
    res.json({ keys: manager.listKeysForUser(req.user.username, isAdminUser(req)) });
});

// POST /api/keys - Create a new API key
router.post('/', requireGlobalPermission('panel.keys'), (req, res) => {
    const manager = getManager(req);
    const { description, type, permissions, allowedServers, allowedIPs } = req.body;

    if (type === 'application' && !isAdminUser(req)) {
        return res.status(403).json({ error: 'Only admins can create application keys' });
    }

    try {
        const key = manager.createKey({
            description: description || 'API Key',
            type: type || 'client',
            username: req.user.username,
            permissions: permissions || [],
            allowedServers: allowedServers || [],
            allowedIPs: allowedIPs || []
        });
        res.status(201).json(key);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/keys/:id - Delete an API key
router.delete('/:id', requireGlobalPermission('panel.keys'), (req, res) => {
    const manager = getManager(req);
    const key = manager.getKeyById(req.params.id);
    if (!key) return res.status(404).json({ error: 'API key not found' });
    if (!isAdminUser(req) && key.username !== req.user.username) {
        return res.status(403).json({ error: 'You can only manage your own API keys' });
    }
    const success = manager.deleteKey(req.params.id);
    if (!success) return res.status(404).json({ error: 'API key not found' });
    res.json({ success: true });
});

// POST /api/keys/:id/toggle - Toggle API key enabled/disabled
router.post('/:id/toggle', requireGlobalPermission('panel.keys'), (req, res) => {
    const manager = getManager(req);
    const existing = manager.getKeyById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'API key not found' });
    if (!isAdminUser(req) && existing.username !== req.user.username) {
        return res.status(403).json({ error: 'You can only manage your own API keys' });
    }
    const key = manager.toggleKey(req.params.id);
    if (!key) return res.status(404).json({ error: 'API key not found' });
    res.json({ id: key.id, enabled: key.enabled });
});

// PATCH /api/keys/:id - Update API key settings
router.patch('/:id', requireGlobalPermission('panel.keys'), (req, res) => {
    const manager = getManager(req);
    const existing = manager.getKeyById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'API key not found' });
    if (!isAdminUser(req) && existing.username !== req.user.username) {
        return res.status(403).json({ error: 'You can only manage your own API keys' });
    }
    const { description, permissions, allowedServers, allowedIPs } = req.body;
    const key = manager.updateKey(req.params.id, { description, permissions, allowedServers, allowedIPs });
    if (!key) return res.status(404).json({ error: 'API key not found' });
    res.json({ success: true });
});

module.exports = router;
