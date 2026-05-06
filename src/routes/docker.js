const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');

const router = express.Router();
router.use(authMiddleware);

// GET /api/docker/status - Check Docker availability and info
router.get('/status', requireGlobalPermission('panel.read'), asyncRoute(async (req, res) => {
    const dockerManager = req.app.locals.dockerManager;
    const info = await dockerManager.getInfo();
    res.json(info);
}));

// GET /api/docker/containers - List FortunaPanel containers
router.get('/containers', requireGlobalPermission('panel.read'), (req, res) => {
    const dockerManager = req.app.locals.dockerManager;
    res.json(dockerManager.listContainers());
});

// GET /api/docker/images - List available images
router.get('/images', requireGlobalPermission('panel.read'), (req, res) => {
    const dockerManager = req.app.locals.dockerManager;
    res.json(dockerManager.listImages());
});

// POST /api/docker/pull - Pull a Docker image
router.post('/pull', requireGlobalPermission('panel.settings'), asyncRoute(async (req, res) => {
    const dockerManager = req.app.locals.dockerManager;
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Image name required' });

    await dockerManager.pullImage(image);
    res.json({ message: `Image ${image} pulled successfully` });
}));

// GET /api/docker/servers/:id/stats - Get container stats for a server
router.get('/servers/:id/stats', requireGlobalPermission('panel.read'), asyncRoute(async (req, res) => {
    const dockerManager = req.app.locals.dockerManager;
    const stats = await dockerManager.getContainerStats(req.params.id);
    if (!stats) return res.status(404).json({ error: 'Container not found or not running' });
    res.json(stats);
}));

module.exports = router;
