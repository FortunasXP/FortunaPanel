const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/notifications/settings - Get notification settings
router.get('/settings', requirePermission('server.settings'), (req, res) => {
    const nm = req.app.locals.notificationManager;
    if (!nm) return res.status(503).json({ error: 'Notification manager not available' });

    res.json(nm.getSettings());
});

// PUT /api/notifications/settings - Update notification settings
router.put('/settings', requirePermission('server.settings'), (req, res) => {
    const nm = req.app.locals.notificationManager;
    if (!nm) return res.status(503).json({ error: 'Notification manager not available' });

    try {
        const settings = nm.updateSettings(req.body);
        res.json(settings);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/notifications/test - Send a test notification
const NotificationManager = require('../managers/NotificationManager');
router.post('/test', requirePermission('server.settings'), async (req, res) => {
    const nm = req.app.locals.notificationManager;
    if (!nm) return res.status(503).json({ error: 'Notification manager not available' });

    const { webhookUrl } = req.body;
    const targetUrl = webhookUrl || nm.settings.discord.webhookUrl;

    if (!targetUrl) return res.status(400).json({ error: 'No webhook URL configured' });
    if (!NotificationManager._isAllowedWebhookUrl(targetUrl)) {
        return res.status(400).json({ error: 'Webhook URL must be a Discord webhook URL (https://discord.com/api/webhooks/...)' });
    }

    try {
        await nm.testWebhook(targetUrl);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
