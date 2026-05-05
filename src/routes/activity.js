const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/activity - Get activity log entries
router.get('/', requireGlobalPermission('panel.activity'), (req, res) => {
    const log = req.app.locals.activityLog;
    if (!log) return res.status(503).json({ error: 'Activity log not available' });

    const options = {
        limit: Math.min(parseInt(req.query.limit) || 50, 200),
        offset: parseInt(req.query.offset) || 0,
        action: req.query.action || null,
        serverId: req.query.serverId || null
    };

    res.json(log.getEntries(options));
});

// GET /api/activity/export - Export activity log as JSON or CSV
router.get('/export', requireGlobalPermission('panel.activity'), (req, res) => {
    const log = req.app.locals.activityLog;
    if (!log) return res.status(503).json({ error: 'Activity log not available' });

    const format = req.query.format || 'json';
    const { entries } = log.getEntries({ limit: 10000 });

    if (format === 'csv') {
        const lines = ['Timestamp,Action,User,Server,Details'];
        for (const e of entries) {
            const details = Object.entries(e.details || {})
                .filter(([k]) => k !== 'serverId')
                .map(([k, v]) => `${k}=${v}`)
                .join('; ');
            lines.push(`"${e.timestamp}","${e.action}","${e.user}","${e.details.serverName || ''}","${details.replace(/"/g, '""')}"`);
        }
        res.setHeader('Content-Disposition', 'attachment; filename="activity-log.csv"');
        res.setHeader('Content-Type', 'text/csv');
        res.send(lines.join('\n'));
    } else {
        res.setHeader('Content-Disposition', 'attachment; filename="activity-log.json"');
        res.setHeader('Content-Type', 'application/json');
        res.json(entries);
    }
});

// DELETE /api/activity - Clear activity log
router.delete('/', requireGlobalPermission('panel.activity'), (req, res) => {
    const log = req.app.locals.activityLog;
    if (!log) return res.status(503).json({ error: 'Activity log not available' });

    log.clear();
    res.json({ success: true });
});

module.exports = router;
