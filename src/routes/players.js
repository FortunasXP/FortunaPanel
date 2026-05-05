const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { safeMinecraftUsername, safeConsoleLine, safeIpAddress } = require('../utils/validation');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.serverManager;
}

function badInput(res, e) {
    return res.status(e.status || 400).json({ error: e.message });
}

// GET /api/servers/:id/players
router.get('/:id/players', requirePermission('player.list'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    res.json({
        online: Array.from(instance.players),
        count: instance.players.size,
        max: instance.config.maxPlayers || 20
    });
});

// POST /api/servers/:id/players/kick
router.post('/:id/players/kick', requirePermission('player.kick'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player, reason;
    try {
        player = safeMinecraftUsername(req.body?.player);
        reason = req.body?.reason ? safeConsoleLine(req.body.reason, 'reason', { maxLength: 200 }) : null;
    } catch (e) { return badInput(res, e); }

    instance.sendCommand(reason ? `kick ${player} ${reason}` : `kick ${player}`);
    res.json({ success: true });
});

// POST /api/servers/:id/players/ban
router.post('/:id/players/ban', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player, reason;
    try {
        player = safeMinecraftUsername(req.body?.player);
        reason = req.body?.reason ? safeConsoleLine(req.body.reason, 'reason', { maxLength: 200 }) : null;
    } catch (e) { return badInput(res, e); }

    instance.sendCommand(reason ? `ban ${player} ${reason}` : `ban ${player}`);
    res.json({ success: true });
});

// POST /api/servers/:id/players/pardon
router.post('/:id/players/pardon', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player;
    try { player = safeMinecraftUsername(req.body?.player); }
    catch (e) { return badInput(res, e); }

    instance.sendCommand(`pardon ${player}`);
    res.json({ success: true });
});

// GET /api/servers/:id/whitelist
router.get('/:id/whitelist', requirePermission('player.whitelist'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const whitelistPath = path.join(instance.config.directory, 'whitelist.json');
    if (!fs.existsSync(whitelistPath)) {
        return res.json([]);
    }

    try {
        const data = JSON.parse(fs.readFileSync(whitelistPath, 'utf-8'));
        res.json(data);
    } catch {
        res.json([]);
    }
});

// POST /api/servers/:id/whitelist/add
router.post('/:id/whitelist/add', requirePermission('player.whitelist'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player;
    try { player = safeMinecraftUsername(req.body?.player); }
    catch (e) { return badInput(res, e); }

    instance.sendCommand(`whitelist add ${player}`);
    res.json({ success: true });
});

// POST /api/servers/:id/whitelist/remove
router.post('/:id/whitelist/remove', requirePermission('player.whitelist'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player;
    try { player = safeMinecraftUsername(req.body?.player); }
    catch (e) { return badInput(res, e); }

    instance.sendCommand(`whitelist remove ${player}`);
    res.json({ success: true });
});

// GET /api/servers/:id/bans
router.get('/:id/bans', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const bansPath = path.join(instance.config.directory, 'banned-players.json');
    if (!fs.existsSync(bansPath)) return res.json([]);

    try {
        const data = JSON.parse(fs.readFileSync(bansPath, 'utf-8'));
        res.json(data);
    } catch {
        res.json([]);
    }
});

// GET /api/servers/:id/ip-bans
router.get('/:id/ip-bans', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const bansPath = path.join(instance.config.directory, 'banned-ips.json');
    if (!fs.existsSync(bansPath)) return res.json([]);

    try {
        const data = JSON.parse(fs.readFileSync(bansPath, 'utf-8'));
        res.json(data);
    } catch {
        res.json([]);
    }
});

// POST /api/servers/:id/ip-bans/pardon
router.post('/:id/ip-bans/pardon', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let ip;
    try { ip = safeIpAddress(req.body?.ip); }
    catch (e) { return badInput(res, e); }

    instance.sendCommand(`pardon-ip ${ip}`);
    res.json({ success: true });
});

// GET /api/servers/:id/ops
router.get('/:id/ops', requirePermission('player.list'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const opsPath = path.join(instance.config.directory, 'ops.json');
    if (!fs.existsSync(opsPath)) return res.json([]);

    try {
        const data = JSON.parse(fs.readFileSync(opsPath, 'utf-8'));
        res.json(data);
    } catch {
        res.json([]);
    }
});

// POST /api/servers/:id/ops/add
router.post('/:id/ops/add', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player;
    try { player = safeMinecraftUsername(req.body?.player); }
    catch (e) { return badInput(res, e); }

    instance.sendCommand(`op ${player}`);
    res.json({ success: true });
});

// POST /api/servers/:id/ops/remove
router.post('/:id/ops/remove', requirePermission('player.ban'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    let player;
    try { player = safeMinecraftUsername(req.body?.player); }
    catch (e) { return badInput(res, e); }

    instance.sendCommand(`deop ${player}`);
    res.json({ success: true });
});

module.exports = router;
