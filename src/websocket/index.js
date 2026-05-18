const WebSocket = require('ws');
const url = require('url');
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const config = require('../config/default');
const { setupHandlers, cleanupHandlers } = require('./handlers');

// Re-verify a token against signature, expiry, and the revocation store.
// Used at connect time and every minute thereafter so a /logout call
// kicks live WS sessions for that user instead of leaving them open
// until natural JWT expiry.
function verifyAndCheckRevocation(token, revokedStore) {
    const decoded = verifyToken(token);
    if (!decoded) return null;
    if (decoded.jti && revokedStore && revokedStore.isRevoked(decoded.jti)) return null;
    return decoded;
}

function isOriginAllowed(origin, host) {
    // No Origin header: accept. Non-browser clients (Electron renderer with no
    // explicit Origin, panel CLI tools) don't send Origin.
    if (!origin) return true;

    // Explicit allowlist from config wins.
    if (config.allowedOrigins && config.allowedOrigins.length) {
        return config.allowedOrigins.includes(origin);
    }

    // Default: same-origin only (Origin host must match request Host).
    try {
        const originHost = new URL(origin).host;
        return originHost === host;
    } catch (_) {
        return false;
    }
}

function setupWebSocket(httpServer, serverManager, systemMonitor, resourceLimiter, networkManager, healthMonitor, permissionManager, jobManager, app) {
    const wss = new WebSocket.Server({
        server: httpServer,
        path: '/ws',
        verifyClient: (info, done) => {
            if (!isOriginAllowed(info.origin, info.req.headers.host)) {
                logger.warn(`WebSocket connection rejected: bad Origin ${info.origin}`);
                return done(false, 403, 'Forbidden origin');
            }
            done(true);
        }
    });

    wss.on('connection', (ws, req) => {
        // Prefer Sec-WebSocket-Protocol token header (not logged, not in history)
        // but fall back to the query string for backward compat.
        let token = null;
        const protoHeader = req.headers['sec-websocket-protocol'];
        if (protoHeader) {
            const protos = protoHeader.split(',').map(s => s.trim());
            const bearer = protos.find(p => p.startsWith('bearer.'));
            if (bearer) token = bearer.slice('bearer.'.length);
        }
        if (!token) {
            const params = new URL(req.url, `http://${req.headers.host}`);
            token = params.searchParams.get('token');
        }
        // Get revocation store via httpServer app reference so we can
        // re-check periodically. May be undefined in tests; degrade to
        // expiry-only validation in that case.
        const revokedStore = app?.locals?.revokedTokenStore || null;
        const user = verifyAndCheckRevocation(token, revokedStore);

        if (!user) {
            ws.close(4001, 'Unauthorized');
            return;
        }

        ws.user = user;
        ws.authToken = token; // kept so we can re-verify periodically
        ws.subscriptions = new Set();
        ws.isAlive = true;

        logger.info(`WebSocket connected: ${user.username}`);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                handleMessage(ws, msg, serverManager, permissionManager);
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
            }
        });

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('close', () => {
            ws.subscriptions.clear();
            logger.info(`WebSocket disconnected: ${user.username}`);
        });
    });

    // Heartbeat ping every 30s
    const heartbeat = setInterval(() => {
        wss.clients.forEach(ws => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    // Token re-validation every 60s. Closes connections whose JWT has
    // expired or been revoked since connect-time. Previously the panel
    // happily streamed console output to a token revoked an hour ago.
    const tokenRecheck = setInterval(() => {
        const revokedStore = app?.locals?.revokedTokenStore || null;
        wss.clients.forEach(ws => {
            if (ws.readyState !== 1) return;
            if (!ws.authToken) return;
            const stillValid = verifyAndCheckRevocation(ws.authToken, revokedStore);
            if (!stillValid) {
                logger.info(`WebSocket revalidation failed: ${ws.user?.username} — closing`);
                try { ws.close(4001, 'Token expired or revoked'); } catch (_) {}
            }
        });
    }, 60000);

    wss.on('close', () => {
        clearInterval(heartbeat);
        clearInterval(tokenRecheck);
        cleanupHandlers();
    });

    // Wire ServerManager and NetworkManager events to broadcast
    setupHandlers(wss, serverManager, networkManager, healthMonitor, jobManager, permissionManager);

    // Wire SystemMonitor stats to broadcast
    if (systemMonitor) {
        systemMonitor.on('stats', (stats) => {
            const message = JSON.stringify({ type: 'system-stats', ...stats });
            wss.clients.forEach(client => {
                if (client.readyState === 1 && client.wantsStats) {
                    client.send(message);
                }
            });
        });
    }

    // Wire ResourceLimiter per-server usage to subscribed clients
    if (resourceLimiter) {
        resourceLimiter.on('usage', (data) => {
            const message = JSON.stringify({ type: 'resource-usage', ...data });
            wss.clients.forEach(client => {
                if (client.readyState === 1 && client.subscriptions.has(data.serverId)) {
                    client.send(message);
                }
            });
        });

        resourceLimiter.on('limit-exceeded', (data) => {
            const message = JSON.stringify({ type: 'resource-alert', ...data });
            wss.clients.forEach(client => {
                if (client.readyState === 1 && client.subscriptions.has(data.serverId)) {
                    client.send(message);
                }
            });
        });
    }

    logger.info('WebSocket server initialized');
    return wss;
}

function handleMessage(ws, msg, serverManager, permissionManager) {
    switch (msg.type) {
        case 'subscribe':
            if (msg.serverId) {
                // Fail closed: if permissionManager is missing the check cannot
                // be made, so deny rather than allowing everyone.
                if (!permissionManager) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Permission subsystem unavailable' }));
                    return;
                }
                if (!permissionManager.hasPermission(ws.user.username, msg.serverId, 'server.console')) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Permission denied: server.console' }));
                    return;
                }
                ws.subscriptions.add(msg.serverId);
            }
            break;

        case 'unsubscribe':
            if (msg.serverId) {
                ws.subscriptions.delete(msg.serverId);
            }
            break;

        case 'command':
            if (msg.serverId && msg.command) {
                if (!permissionManager) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Permission subsystem unavailable' }));
                    return;
                }
                if (!permissionManager.hasPermission(ws.user.username, msg.serverId, 'server.command')) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Permission denied: server.command' }));
                    return;
                }
                // Match the REST route's 500-char cap so a misbehaving
                // client can't shovel megabytes per second through stdin.
                if (typeof msg.command !== 'string') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Command must be a string' }));
                    return;
                }
                if (msg.command.length > 500) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Command too long (max 500 chars)' }));
                    return;
                }
                const instance = serverManager.getServer(msg.serverId);
                if (instance) {
                    instance.sendCommand(msg.command);
                }
            }
            break;

        case 'subscribe-stats':
            ws.wantsStats = true;
            break;
    }
}

module.exports = { setupWebSocket };
