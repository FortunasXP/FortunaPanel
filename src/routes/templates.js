const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.serverManager;
}

// GET /api/templates - List all templates
router.get('/', requirePermission('server.settings'), (req, res) => {
    const manager = getManager(req);
    res.json(manager.getTemplates());
});

// POST /api/templates - Save server as template
router.post('/', requirePermission('server.settings'), (req, res) => {
    const manager = getManager(req);
    const { serverId, name } = req.body;
    if (!serverId) return res.status(400).json({ error: 'Server ID required' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Template name required' });

    try {
        const template = manager.saveAsTemplate(serverId, name.trim());

        const activityLog = req.app.locals.activityLog;
        if (activityLog) {
            activityLog.log('template.create', {
                templateId: template.id,
                templateName: template.name,
                sourceServer: template.sourceServer
            }, req.user.username);
        }

        res.status(201).json(template);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/templates/:id/create - Create server from template
router.post('/:id/create', requirePermission('server.create'), async (req, res) => {
    const manager = getManager(req);
    const { name, port, memory } = req.body;

    try {
        const instance = await manager.createFromTemplate(req.params.id, { name, port, memory });

        const activityLog = req.app.locals.activityLog;
        if (activityLog) {
            const template = manager.getTemplate(req.params.id);
            activityLog.log('server.create', {
                serverId: instance.id,
                serverName: instance.name,
                fromTemplate: template?.name
            }, req.user.username);
        }

        res.status(201).json(instance.getStatus());
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', requirePermission('server.settings'), (req, res) => {
    const manager = getManager(req);
    try {
        const removed = manager.deleteTemplate(req.params.id);
        res.json({ success: true, name: removed.name });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

module.exports = router;
