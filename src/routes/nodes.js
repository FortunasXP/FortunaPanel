const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/nodes - List all nodes (includes local)
router.get('/', requireGlobalPermission('panel.read'), (req, res) => {
    const nodeManager = req.app.locals.nodeManager;
    const nodes = [
        nodeManager.getLocalNode(),
        ...nodeManager.listNodes()
    ];
    res.json(nodes);
});

// POST /api/nodes - Register a new remote node
router.post('/', requireGlobalPermission('panel.settings'), (req, res) => {
    const nodeManager = req.app.locals.nodeManager;
    const { name, host, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Node name is required' });

    try {
        const node = nodeManager.registerNode({ name, host, description });
        res.status(201).json(node);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// GET /api/nodes/:id - Get node details
router.get('/:id', requireGlobalPermission('panel.read'), (req, res) => {
    const nodeManager = req.app.locals.nodeManager;

    if (req.params.id === 'local') {
        return res.json(nodeManager.getLocalNode());
    }

    const node = nodeManager.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    res.json(node);
});

// PUT /api/nodes/:id - Update a node
router.put('/:id', requireGlobalPermission('panel.settings'), (req, res) => {
    const nodeManager = req.app.locals.nodeManager;
    try {
        const node = nodeManager.updateNode(req.params.id, req.body);
        res.json(node);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/nodes/:id - Remove a node
router.delete('/:id', requireGlobalPermission('panel.settings'), (req, res) => {
    const nodeManager = req.app.locals.nodeManager;
    try {
        nodeManager.removeNode(req.params.id);
        res.json({ message: 'Node removed' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/nodes/:id/regenerate-token - Regenerate connection token
router.post('/:id/regenerate-token', requireGlobalPermission('panel.settings'), (req, res) => {
    const nodeManager = req.app.locals.nodeManager;
    try {
        const node = nodeManager.regenerateToken(req.params.id);
        res.json(node);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
