// FortunaPanel - Permission Management Routes
const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.permissionManager;
}

function requireAdmin(req, res, next) {
    const userStore = req.app.locals.userStore;
    const admin = userStore.getAdmin();
    if (!admin) return res.status(503).json({ error: 'Panel not set up' });
    if (req.user.username !== admin.username && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// GET /api/permissions - Get all available permissions
router.get('/', requireAdmin, (req, res) => {
    const manager = getManager(req);
    res.json({
        permissions: manager.getAllPermissions(),
        rolePresets: manager.getRolePresets()
    });
});

// GET /api/permissions/server/:serverId - Get subusers and permissions for a server
router.get('/server/:serverId', requireAdmin, (req, res) => {
    const manager = getManager(req);
    const subusers = manager.getServerSubusers(req.params.serverId);
    res.json({ subusers });
});

// GET /api/permissions/server/:serverId/user/:username - Get permissions for a user on a server
router.get('/server/:serverId/user/:username', requireAdmin, (req, res) => {
    const manager = getManager(req);
    const permissions = manager.getPermissions(req.params.serverId, req.params.username);
    res.json({ username: req.params.username, permissions });
});

// PUT /api/permissions/server/:serverId/user/:username - Set permissions for a user
router.put('/server/:serverId/user/:username', requireAdmin, (req, res) => {
    const manager = getManager(req);
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: 'Permissions must be an array' });
    }

    manager.setPermissions(req.params.serverId, req.params.username, permissions);
    res.json({ success: true });
});

// DELETE /api/permissions/server/:serverId/user/:username - Reset permissions to role defaults
router.delete('/server/:serverId/user/:username', requireAdmin, (req, res) => {
    const manager = getManager(req);
    manager.removePermissions(req.params.serverId, req.params.username);
    res.json({ success: true });
});

// POST /api/permissions/check - Check if current user has permission
router.post('/check', requireGlobalPermission('panel.read'), (req, res) => {
    const manager = getManager(req);
    const { serverId, permission } = req.body;
    const allowed = manager.hasPermission(req.user.username, serverId, permission);
    res.json({ allowed });
});

module.exports = router;
