const logger = require('../utils/logger');

let statsInterval = null;

/**
 * Send a server-scoped event only to clients that have `server.console`
 * permission for that specific server. Falls back to `broadcast` (the
 * per-subscription filter) when no permissionManager is wired — but
 * NEVER falls back to broadcastAll, which would let a viewer enumerate
 * all servers' status/crashes/players regardless of their permissions.
 */
function broadcastByServerPermission(wss, serverId, permission, data, permissionManager) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        const username = client.user?.username;
        if (!username) return;
        if (permissionManager) {
            if (!permissionManager.hasPermission(username, serverId, permission)) return;
        } else {
            // No permission system available — fail closed: require an
            // explicit per-server subscription to receive the event.
            if (!client.subscriptions?.has(serverId)) return;
        }
        client.send(message);
    });
}

function setupHandlers(wss, serverManager, networkManager, healthMonitor, jobManager, permissionManager) {
    // Broadcast console output to subscribed clients
    serverManager.on('console', (data) => {
        broadcast(wss, data.serverId, {
            type: 'console',
            serverId: data.serverId,
            line: data.line,
            level: data.level,
            timestamp: data.timestamp
        });
    });

    // Broadcast status changes — per-server events go only to clients
    // with `server.console` permission for that server, not every
    // connected client.
    serverManager.on('status', (data) => {
        broadcast(wss, data.serverId, {
            type: 'status',
            serverId: data.serverId,
            status: data.status,
            previousStatus: data.previousStatus
        });

        broadcastByServerPermission(wss, data.serverId, 'server.console', {
            type: 'server-status',
            serverId: data.serverId,
            status: data.status
        }, permissionManager);
    });

    // Broadcast player events to subscribed clients (server detail page)
    serverManager.on('player-join', (data) => {
        broadcast(wss, data.serverId, {
            type: 'player-join',
            serverId: data.serverId,
            player: data.player
        });
        broadcastByServerPermission(wss, data.serverId, 'server.console', {
            type: 'player-update',
            serverId: data.serverId,
            action: 'join',
            player: data.player,
            online: data.playerCount
        }, permissionManager);
    });

    serverManager.on('player-leave', (data) => {
        broadcast(wss, data.serverId, {
            type: 'player-leave',
            serverId: data.serverId,
            player: data.player
        });
        broadcastByServerPermission(wss, data.serverId, 'server.console', {
            type: 'player-update',
            serverId: data.serverId,
            action: 'leave',
            player: data.player,
            online: data.playerCount
        }, permissionManager);
    });

    // Broadcast server errors
    serverManager.on('server-error', (data) => {
        broadcast(wss, data.serverId, {
            type: 'error',
            serverId: data.serverId,
            message: data.message
        });
    });

    // Broadcast crash events — per-server, permission-gated
    serverManager.on('crash', (data) => {
        broadcastByServerPermission(wss, data.serverId, 'server.console', {
            type: 'server-crash',
            serverId: data.serverId,
            exitCode: data.exitCode,
            crashCount: data.crashCount,
            willRestart: data.willRestart,
            nextRestartIn: data.nextRestartIn
        }, permissionManager);
    });

    serverManager.on('max-crashes', (data) => {
        broadcastByServerPermission(wss, data.serverId, 'server.console', {
            type: 'server-max-crashes',
            serverId: data.serverId,
            crashCount: data.crashCount,
            maxAutoRestarts: data.maxAutoRestarts
        }, permissionManager);
    });

    // Broadcast network events to all clients
    if (networkManager) {
        networkManager.on('network-created', (data) => {
            broadcastAll(wss, { type: 'network-created', networkId: data.networkId, name: data.name });
        });

        networkManager.on('network-deleted', (data) => {
            broadcastAll(wss, { type: 'network-deleted', networkId: data.networkId, name: data.name });
        });

        networkManager.on('backend-added', (data) => {
            broadcastAll(wss, { type: 'network-backend-changed', networkId: data.networkId, action: 'added', serverId: data.serverId, alias: data.alias });
        });

        networkManager.on('backend-removed', (data) => {
            broadcastAll(wss, { type: 'network-backend-changed', networkId: data.networkId, action: 'removed', serverId: data.serverId });
        });

        networkManager.on('network-started', (data) => {
            broadcastAll(wss, { type: 'network-status', networkId: data.networkId, name: data.name, status: 'started' });
        });

        networkManager.on('network-stopped', (data) => {
            broadcastAll(wss, { type: 'network-status', networkId: data.networkId, name: data.name, status: 'stopped' });
        });

        networkManager.on('rolling-restart-started', (data) => {
            broadcastAll(wss, { type: 'rolling-restart-started', ...data });
        });
        networkManager.on('rolling-restart-progress', (data) => {
            broadcastAll(wss, { type: 'rolling-restart-progress', ...data });
        });
        networkManager.on('rolling-restart-completed', (data) => {
            broadcastAll(wss, { type: 'rolling-restart-completed', ...data });
        });
        networkManager.on('maintenance-changed', (data) => {
            broadcastAll(wss, { type: 'maintenance-changed', ...data });
        });
    }

    // Health monitor events
    if (healthMonitor) {
        healthMonitor.on('health-changed', (data) => {
            broadcastAll(wss, { type: 'health-changed', ...data });
        });
        healthMonitor.on('auto-restart-triggered', (data) => {
            broadcastAll(wss, { type: 'health-auto-restart', ...data });
        });
    }

    if (jobManager) {
        jobManager.on('job-update', (job) => {
            broadcastAll(wss, { type: 'job-update', job });
        });
    }

    // Periodic stats broadcast (every 5 seconds). Filter the stats map
    // PER CLIENT so a viewer only sees the servers they have permission
    // to read — previously every subscribed client saw every server's
    // status/players/uptime.
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(() => {
        const fullStats = {};
        const allServers = serverManager.getAllServers();
        for (const server of allServers) {
            fullStats[server.id] = {
                status: server.status,
                players: server.players,
                uptime: server.uptime
            };
        }

        wss.clients.forEach(client => {
            if (client.readyState !== 1 || !client.wantsStats) return;
            const username = client.user?.username;
            if (!username) return;

            let visible = fullStats;
            if (permissionManager) {
                visible = {};
                for (const server of allServers) {
                    if (permissionManager.hasPermission(username, server.id, 'server.console')) {
                        visible[server.id] = fullStats[server.id];
                    }
                }
            }
            client.send(JSON.stringify({ type: 'stats', servers: visible }));
        });
    }, 5000);
}

function broadcast(wss, serverId, data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.subscriptions.has(serverId)) {
            client.send(message);
        }
    });
}

function broadcastAll(wss, data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(message);
        }
    });
}

function cleanupHandlers() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
}

module.exports = { setupHandlers, cleanupHandlers };
