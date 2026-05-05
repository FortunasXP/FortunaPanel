const logger = require('../utils/logger');

let statsInterval = null;

function setupHandlers(wss, serverManager, networkManager, healthMonitor, jobManager) {
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

    // Broadcast status changes
    serverManager.on('status', (data) => {
        broadcast(wss, data.serverId, {
            type: 'status',
            serverId: data.serverId,
            status: data.status,
            previousStatus: data.previousStatus
        });

        // Also broadcast to all clients (for dashboard updates)
        broadcastAll(wss, {
            type: 'server-status',
            serverId: data.serverId,
            status: data.status
        });
    });

    // Broadcast player events
    serverManager.on('player-join', (data) => {
        broadcast(wss, data.serverId, {
            type: 'player-join',
            serverId: data.serverId,
            player: data.player
        });
    });

    serverManager.on('player-leave', (data) => {
        broadcast(wss, data.serverId, {
            type: 'player-leave',
            serverId: data.serverId,
            player: data.player
        });
    });

    // Broadcast server errors
    serverManager.on('server-error', (data) => {
        broadcast(wss, data.serverId, {
            type: 'error',
            serverId: data.serverId,
            message: data.message
        });
    });

    // Broadcast crash events
    serverManager.on('crash', (data) => {
        broadcastAll(wss, {
            type: 'server-crash',
            serverId: data.serverId,
            exitCode: data.exitCode,
            crashCount: data.crashCount,
            willRestart: data.willRestart,
            nextRestartIn: data.nextRestartIn
        });
    });

    serverManager.on('max-crashes', (data) => {
        broadcastAll(wss, {
            type: 'server-max-crashes',
            serverId: data.serverId,
            crashCount: data.crashCount,
            maxAutoRestarts: data.maxAutoRestarts
        });
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

    // Periodic stats broadcast (every 5 seconds)
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(() => {
        const stats = {};
        for (const server of serverManager.getAllServers()) {
            stats[server.id] = {
                status: server.status,
                players: server.players,
                uptime: server.uptime
            };
        }

        wss.clients.forEach(client => {
            if (client.readyState === 1 && client.wantsStats) {
                client.send(JSON.stringify({ type: 'stats', servers: stats }));
            }
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
