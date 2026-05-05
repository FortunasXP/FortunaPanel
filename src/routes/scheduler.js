const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const Scheduler = require('../managers/Scheduler');
const { asyncRoute, badRequest, notFound } = require('../utils/http');
const { optionalString, requireNumber, optionalBoolean } = require('../utils/validation');

const router = express.Router();
router.use(authMiddleware);

// GET /api/schedule - Get all scheduled tasks
router.get('/', requirePermission('schedule.view'), (req, res) => {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) return res.status(503).json({ error: 'Scheduler not available' });

    const serverId = req.query.serverId || null;
    const networkId = req.query.networkId || null;
    res.json({ tasks: scheduler.getTasks(serverId, networkId) });
});

// POST /api/schedule - Create a scheduled task
router.post('/', requirePermission('schedule.manage'), asyncRoute(async (req, res) => {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) throw badRequest('Scheduler not available');

    const serverId = optionalString(req.body.serverId, 'serverId');
    const networkId = optionalString(req.body.networkId, 'networkId');
    const type = optionalString(req.body.type, 'type');
    const intervalMinutes = requireNumber(req.body.intervalMinutes, 'intervalMinutes', { integer: true, min: 1, max: 10080 });
    const command = optionalString(req.body.command, 'command', { max: 2000 });
    const name = optionalString(req.body.name, 'name', { max: 120 }) || undefined;
    const enabled = optionalBoolean(req.body.enabled);

    if (!type) {
        throw badRequest('type is required');
    }

    if (!serverId && !networkId) {
        throw badRequest('serverId or networkId is required');
    }

    // Validate type based on target
    if (networkId) {
        if (!Scheduler.NETWORK_TYPES.includes(type)) {
            throw badRequest(`Invalid type for network task. Must be: ${Scheduler.NETWORK_TYPES.join(', ')}`);
        }
    } else {
        if (!Scheduler.SERVER_TYPES.includes(type)) {
            throw badRequest(`Invalid type for server task. Must be: ${Scheduler.SERVER_TYPES.join(', ')}`);
        }
    }

    if (type === 'command' && !command) {
        throw badRequest('Command is required for command tasks');
    }

    // Optional maxBackups for backup tasks (retention limit)
    let maxBackups;
    if (type === 'backup' && req.body.maxBackups !== undefined && req.body.maxBackups !== null) {
        maxBackups = requireNumber(req.body.maxBackups, 'maxBackups', { integer: true, min: 1, max: 100 });
    }

    const task = scheduler.createTask({ serverId, networkId, type, intervalMinutes, command, name, enabled, maxBackups });
    res.json(task);
}));

// PUT /api/schedule/:id - Update a task
router.put('/:id', requirePermission('schedule.manage'), asyncRoute(async (req, res) => {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) throw badRequest('Scheduler not available');

    let task;
    try {
        task = scheduler.updateTask(req.params.id, req.body);
    } catch (e) {
        if (e.message === 'Task not found') throw notFound('Task not found');
        throw badRequest(e.message);
    }
    res.json(task);
}));

// POST /api/schedule/:id/toggle - Toggle a task on/off
router.post('/:id/toggle', requirePermission('schedule.manage'), asyncRoute(async (req, res) => {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) throw badRequest('Scheduler not available');

    const task = scheduler.toggleTask(req.params.id);
    if (!task) throw notFound('Task not found');
    res.json(task);
}));

// POST /api/schedule/:id/execute - Execute a task now
router.post('/:id/execute', requirePermission('schedule.manage'), asyncRoute(async (req, res) => {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) throw badRequest('Scheduler not available');

    await scheduler.executeTask(req.params.id);
    res.json({ success: true });
}));

// DELETE /api/schedule/:id - Delete a task
router.delete('/:id', requirePermission('schedule.manage'), asyncRoute(async (req, res) => {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) throw badRequest('Scheduler not available');

    const removed = scheduler.deleteTask(req.params.id);
    if (!removed) throw notFound('Task not found');
    res.json({ success: true });
}));

module.exports = router;
