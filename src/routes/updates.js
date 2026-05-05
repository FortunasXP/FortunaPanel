const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');

const router = express.Router();
router.use(authMiddleware);

// GET /api/updates - Get update status
router.get('/', requireGlobalPermission('panel.read'), (req, res) => {
    const checker = req.app.locals.updateChecker;
    if (!checker) return res.status(503).json({ error: 'Update checker not available' });
    res.json(checker.getStatus());
});

// POST /api/updates/check - Force a check now
router.post('/check', requireGlobalPermission('panel.settings'), asyncRoute(async (req, res) => {
    const checker = req.app.locals.updateChecker;
    if (!checker) return res.status(503).json({ error: 'Update checker not available' });
    const status = await checker.check();
    res.json(status);
}));

// POST /api/updates/dismiss - Dismiss current update notification
router.post('/dismiss', requireGlobalPermission('panel.read'), (req, res) => {
    const checker = req.app.locals.updateChecker;
    if (!checker) return res.status(503).json({ error: 'Update checker not available' });
    checker.dismiss(req.body.version);
    res.json({ dismissed: true });
});

module.exports = router;
