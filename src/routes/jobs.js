const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const { requireNumber } = require('../utils/validation');
const { getSqliteStore } = require('../db/sqlite');

const router = express.Router();
router.use(authMiddleware);

function getJobManager(req) {
    return req.app.locals.jobManager;
}

router.get('/migrations', requireGlobalPermission('panel.read'), (req, res) => {
    const store = getSqliteStore();
    if (!store.enabled) {
        return res.json({
            sqliteEnabled: false,
            migrations: []
        });
    }

    return res.json({
        sqliteEnabled: true,
        dbPath: store.dbPath,
        migrations: store.getMigrationStatus()
    });
});

router.get('/', requireGlobalPermission('panel.read'), (req, res) => {
    const jm = getJobManager(req);
    const limit = req.query.limit === undefined
        ? 50
        : requireNumber(req.query.limit, 'limit', { integer: true, min: 1, max: 500 });
    const status = req.query.status || null;
    res.json({ jobs: jm.listJobs({ limit, status }) });
});

router.get('/:id', requireGlobalPermission('panel.read'), (req, res) => {
    const jm = getJobManager(req);
    const job = jm.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

router.post('/:id/cancel', requireGlobalPermission('panel.settings'), (req, res) => {
    const jm = getJobManager(req);
    const cancelled = jm.cancelJob(req.params.id);
    if (!cancelled) {
        return res.status(400).json({ error: 'Job cannot be cancelled (not queued or not found)' });
    }
    res.json({ success: true });
});

module.exports = router;
