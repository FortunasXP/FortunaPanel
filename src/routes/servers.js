const express = require('express');
const { authMiddleware, requirePermission, requireGlobalPermission } = require('../middleware/auth');
const { asyncRoute, badRequest, notFound } = require('../utils/http');
const { requireString, optionalString, requireNumber, optionalBoolean } = require('../utils/validation');

const router = express.Router();

// All routes require auth
router.use(authMiddleware);

// The serverManager is injected via app.locals
function getManager(req) {
    return req.app.locals.serverManager;
}

// GET /api/servers - List all servers
router.get('/', requireGlobalPermission('panel.read'), (req, res) => {
    const manager = getManager(req);
    res.json(manager.getAllServers());
});

// POST /api/servers/import - Import existing server
router.post('/import', requirePermission('server.settings'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const { detectServerConfig } = require('../services/serverDetector');

    const directory = requireString(req.body.directory, 'directory', { max: 500 });
    const name = optionalString(req.body.name, 'name', { max: 120 }) || undefined;
    const port = req.body.port === undefined ? undefined : requireNumber(req.body.port, 'port', { integer: true, min: 1, max: 65535 });
    const detect = optionalBoolean(req.body.detect) || false;
    const memory = req.body.memory;

    // Detection-only mode: just return what we found
    if (detect) {
        const detected = detectServerConfig(directory);
        return res.json({ detected });
    }

    // Perform import
    const instance = await manager.importServer(directory, { name, port, memory });

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('server.import', {
            serverId: instance.id,
            serverName: instance.name,
            directory,
            type: instance.config.type
        }, req.user.username);
    }

    res.status(201).json(instance.getStatus());
}));

// GET /api/servers/ports/overview - Port allocation overview
router.get('/ports/overview', requireGlobalPermission('panel.read'), (req, res) => {
    const manager = getManager(req);
    const usedPorts = manager.getUsedPorts();
    res.json({
        usedPorts,
        nextAvailable: manager.getNextAvailablePort(),
        totalAllocated: usedPorts.length
    });
});

// GET /api/servers/:id - Get single server details
router.get('/:id', requirePermission('server.console'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    res.json({
        ...instance.getStatus(),
        directory: instance.config.directory,
        jarFile: instance.config.jarFile,
        jvmArgs: instance.config.jvmArgs,
        autoStart: instance.config.autoStart,
        autoRestart: instance.config.autoRestart || false,
        maxAutoRestarts: instance.config.maxAutoRestarts ?? 3,
        createdAt: instance.config.createdAt,
        lastStarted: instance.config.lastStarted,
        suspended: instance.config.suspended || false,
        suspendedAt: instance.config.suspendedAt || null,
        suspendedBy: instance.config.suspendedBy || null,
        resourceLimits: instance.config.resourceLimits || null,
        dns: instance.config.dns || null,
        consoleHistory: instance.getConsoleHistory()
    });
});

// POST /api/servers - Create new server
router.post('/', requirePermission('server.create'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    requireString(req.body.name, 'name', { max: 120 });
    let portReassigned = null;
    if (req.body.port !== undefined) {
        const port = requireNumber(req.body.port, 'port', { integer: true, min: 1, max: 65535 });
        if (!manager.isPortAvailable(port)) {
            // Upload path: silently auto-assign so a zip with a default port
            // (e.g. 25565) doesn't fail when another server already owns it.
            // Manual creation: bubble the conflict so the user notices their
            // explicit choice was rejected.
            if (req.body.sourceDirectory !== undefined) {
                req.body.port = manager.getNextAvailablePort();
                portReassigned = { requested: port, assigned: req.body.port };
            } else {
                throw badRequest(`Port ${port} is already in use by another server`);
            }
        } else {
            req.body.port = port;
        }
    }
    // Security: sourceDirectory must point inside our archive staging area
    if (req.body.sourceDirectory !== undefined) {
        const path = require('path');
        const config = require('../config/default');
        const stagingRoot = path.resolve(config.jarsCache, 'archive');
        const candidate = path.resolve(String(req.body.sourceDirectory));
        if (!candidate.startsWith(stagingRoot + path.sep)) {
            throw badRequest('sourceDirectory must reference an uploaded archive');
        }
    }
    try {
        const instance = await manager.createServer(req.body);
        const status = instance.getStatus();
        if (portReassigned) status.portReassigned = portReassigned;
        res.status(201).json(status);
    } catch (err) {
        // Surface manager-level validation errors (max servers, etc.) as 400s
        // so the client sees the real reason instead of a generic
        // "Internal server error" — these messages are safe to expose.
        throw badRequest(err.message);
    }
}));

// DELETE /api/servers/:id - Delete server
router.delete('/:id', requirePermission('server.delete'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    try {
        await manager.deleteServer(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}));

// PATCH /api/servers/:id - Update server config
router.patch('/:id', requirePermission('server.settings'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    // Validate port conflict if port is being changed
    if (req.body.port !== undefined) {
        const port = requireNumber(req.body.port, 'port', { integer: true, min: 1, max: 65535 });
        if (!manager.isPortAvailable(port, req.params.id)) {
            throw badRequest(`Port ${port} is already in use by another server`);
        }
        req.body.port = port;
    }
    if (req.body.name !== undefined) {
        req.body.name = requireString(req.body.name, 'name', { max: 120 });
    }

    // Capture before state for diff
    const instance = manager.getServer(req.params.id);
    if (!instance) throw notFound('Server not found');
    const before = instance ? { ...instance.config } : {};

    const updated = await manager.updateServer(req.params.id, req.body);

    // Log with diff
    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        const diff = { before: {}, after: {} };
        for (const key of Object.keys(req.body)) {
            if (JSON.stringify(before[key]) !== JSON.stringify(updated.config[key])) {
                diff.before[key] = before[key];
                diff.after[key] = updated.config[key];
            }
        }
        if (Object.keys(diff.before).length > 0) {
            activityLog.log('server.settings', {
                serverId: req.params.id,
                serverName: updated.name
            }, req.user.username, diff);
        }
    }

    res.json(updated.getStatus());
}));

// POST /api/servers/:id/start
router.post('/:id/start', requirePermission('server.start'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (instance?.config.suspended) {
        return res.status(403).json({ error: 'Server is suspended. Unsuspend it before starting.' });
    }
    try {
        await manager.startServer(req.params.id);
        res.json({ status: 'starting' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}));

// POST /api/servers/:id/stop
router.post('/:id/stop', requirePermission('server.stop'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    try {
        await manager.stopServer(req.params.id);
        res.json({ status: 'stopping' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}));

// POST /api/servers/:id/restart
router.post('/:id/restart', requirePermission('server.restart'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    try {
        await manager.restartServer(req.params.id);
        res.json({ status: 'restarting' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}));

// POST /api/servers/:id/command
router.post('/:id/command', requirePermission('server.command'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    if (!command) return res.status(400).json({ error: 'Command required' });
    if (command.length > 500) return res.status(400).json({ error: 'Command too long' });

    const sent = instance.sendCommand(command);
    if (!sent) return res.status(400).json({ error: 'Server is not running' });

    res.json({ success: true });
});

// POST /api/servers/:id/suspend - Suspend a server
router.post('/:id/suspend', requirePermission('server.suspend'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    // Stop if running
    if (instance.process) {
        await instance.stop();
    }

    instance.config.suspended = true;
    instance.config.suspendedAt = new Date().toISOString();
    instance.config.suspendedBy = req.user.username;
    await manager.saveRegistry();

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('server.suspend', { serverId: req.params.id, serverName: instance.name }, req.user.username);
    }

    res.json({ success: true, suspended: true });
}));

// POST /api/servers/:id/unsuspend - Unsuspend a server
router.post('/:id/unsuspend', requirePermission('server.suspend'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    instance.config.suspended = false;
    instance.config.suspendedAt = null;
    instance.config.suspendedBy = null;
    await manager.saveRegistry();

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('server.unsuspend', { serverId: req.params.id, serverName: instance.name }, req.user.username);
    }

    res.json({ success: true, suspended: false });
}));

// PATCH /api/servers/:id/auto-restart - Toggle auto-restart settings
router.patch('/:id/auto-restart', requirePermission('server.settings'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const { autoRestart, maxAutoRestarts, crashCooldown } = req.body;
    if (autoRestart !== undefined) instance.config.autoRestart = !!autoRestart;
    if (maxAutoRestarts !== undefined) instance.config.maxAutoRestarts = Math.max(1, Math.min(10, parseInt(maxAutoRestarts) || 3));
    if (crashCooldown !== undefined) instance.config.crashCooldown = Math.max(30000, Math.min(600000, parseInt(crashCooldown) || 300000));

    await manager.saveRegistry();

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('server.settings', {
            serverId: req.params.id,
            serverName: instance.name,
            change: 'auto-restart',
            autoRestart: instance.config.autoRestart,
            maxAutoRestarts: instance.config.maxAutoRestarts,
            crashCooldown: instance.config.crashCooldown
        }, req.user.username);
    }

    res.json({
        autoRestart: instance.config.autoRestart,
        maxAutoRestarts: instance.config.maxAutoRestarts,
        crashCooldown: instance.config.crashCooldown || 300000
    });
}));

// POST /api/servers/:id/reinstall - Reinstall a server (clean reset)
router.post('/:id/reinstall', requirePermission('server.reinstall'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    // Must be stopped
    if (instance.process) {
        return res.status(400).json({ error: 'Server must be stopped before reinstalling' });
    }

    const fs = require('fs');
    const path = require('path');
    const dir = instance.config.directory;
    const jarFile = instance.config.jarFile;

    try {
        // Delete everything except the JAR file
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            if (entry === jarFile) continue;
            const fullPath = path.join(dir, entry);
            fs.rmSync(fullPath, { recursive: true, force: true });
        }

        // Re-create eula.txt
        fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');

        // Write initial server.properties if port is set
        if (instance.config.port) {
            const props = [];
            props.push(`server-port=${instance.config.port}`);
            if (instance.config.maxPlayers) props.push(`max-players=${instance.config.maxPlayers}`);
            fs.writeFileSync(path.join(dir, 'server.properties'), props.join('\n') + '\n');
        }

        instance.config.reinstalledAt = new Date().toISOString();
        await manager.saveRegistry();

        const activityLog = req.app.locals.activityLog;
        if (activityLog) {
            activityLog.log('server.reinstall', { serverId: req.params.id, serverName: instance.name }, req.user.username);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: `Reinstall failed: ${err.message}` });
    }
}));

// POST /api/servers/:id/clone - Clone a server
router.post('/:id/clone', requirePermission('server.settings'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    try {
        const { name, copyWorld = true, copyPlugins = true } = req.body;
        const instance = await manager.cloneServer(req.params.id, name, { copyWorld, copyPlugins });

        const activityLog = req.app.locals.activityLog;
        if (activityLog) {
            const source = manager.getServer(req.params.id);
            activityLog.log('server.clone', {
                serverId: instance.id,
                serverName: instance.name,
                sourceId: req.params.id,
                sourceName: source?.name
            }, req.user.username);
        }

        res.status(201).json(instance.getStatus());
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}));

// GET /api/servers/:id/export - Export server as zip download
router.get('/:id/export', requirePermission('backup.create'), asyncRoute(async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const backupManager = req.app.locals.backupManager;
    if (!backupManager) return res.status(500).json({ error: 'Backup manager unavailable' });

    try {
        // Create temp backup
        const backup = await backupManager.createBackup(req.params.id, instance.config.directory, 'export');
        const backupPath = backup.path;

        // Sanitize filename: strip quotes and non-ASCII to prevent header injection
        const safeName = instance.name.replace(/["\r\n]/g, '').replace(/[^\x20-\x7E]/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}-export.zip"`);
        res.setHeader('Content-Type', 'application/zip');

        const fs = require('fs');
        const stream = fs.createReadStream(backupPath);
        stream.pipe(res);

        // Clean up temp backup after download
        stream.on('end', () => {
            try { fs.unlinkSync(backupPath); } catch (e) {}
        });
    } catch (err) {
        res.status(500).json({ error: `Export failed: ${err.message}` });
    }
}));

module.exports = router;
