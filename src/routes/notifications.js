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

    const settings = nm.updateSettings(req.body);
    res.json(settings);
});

// POST /api/notifications/test - Send a test notification
router.post('/test', requirePermission('server.settings'), async (req, res) => {
    const nm = req.app.locals.notificationManager;
    if (!nm) return res.status(503).json({ error: 'Notification manager not available' });

    const { webhookUrl } = req.body;
    const targetUrl = webhookUrl || nm.settings.discord.webhookUrl;

    // SSRF protection: only allow HTTPS Discord webhook URLs
    if (targetUrl) {
        try {
            const parsed = new URL(targetUrl);
            if (parsed.protocol !== 'https:') {
                return res.status(400).json({ error: 'Webhook URL must use HTTPS' });
            }
            // Block private/internal IPs
            const hostname = parsed.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
                hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
                hostname.match(/^172\.(1[6-9]|2\d|3[01])\./) ||
                hostname === '0.0.0.0' || hostname.startsWith('169.254.')) {
                return res.status(400).json({ error: 'Webhook URL must not point to internal addresses' });
            }
        } catch {
            return res.status(400).json({ error: 'Invalid webhook URL' });
        }
    }

    try {
        await nm.testWebhook(targetUrl);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
