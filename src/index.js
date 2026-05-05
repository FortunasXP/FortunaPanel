const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config/default');
const logger = require('./utils/logger');
const ServerManager = require('./managers/ServerManager');
const SystemMonitor = require('./managers/SystemMonitor');
const ActivityLog = require('./managers/ActivityLog');
const BackupManager = require('./managers/BackupManager');
const JobManager = require('./managers/JobManager');
const Scheduler = require('./managers/Scheduler');
const NotificationManager = require('./managers/NotificationManager');
const ApiKeyManager = require('./managers/ApiKeyManager');
const TwoFactorManager = require('./managers/TwoFactorManager');
const PermissionManager = require('./managers/PermissionManager');
const UserStore = require('./managers/UserStore');
const ResourceLimiter = require('./managers/ResourceLimiter');
const SFTPServer = require('./managers/SFTPServer');
const RevokedTokenStore = require('./managers/RevokedTokenStore');
const NetworkManager = require('./managers/NetworkManager');
const HealthMonitor = require('./managers/HealthMonitor');
const DnsManager = require('./managers/DnsManager');
const StatsCollector = require('./managers/StatsCollector');
const { setupWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);

if (!config.jwtSecret) {
    throw new Error('JWT_SECRET must be set in production');
}

// Middleware
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
});

// Baseline HTTP security headers. CSP is intentionally conservative; adjust
// via ALLOWED_ORIGINS / CSP_* env vars if you host assets elsewhere.
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Only set HSTS over TLS to avoid breaking plain-HTTP dev.
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "img-src 'self' data: blob:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline'",
            "connect-src 'self' ws: wss:",
            "font-src 'self' data:",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'self'"
        ].join('; ')
    );
    next();
});

// CORS: same-origin requests are always allowed. If an Origin header is
// presented and it matches the request Host (i.e. the browser is hitting the
// panel's own URL), treat it as same-origin. Cross-origin is only allowed
// when explicitly listed in config.allowedOrigins.
function isSameOrigin(origin, host) {
    if (!origin || !host) return false;
    try {
        const u = new URL(origin);
        return u.host === host;
    } catch (_) {
        return false;
    }
}

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        const allowlist = config.allowedOrigins || [];
        const sameOrigin = isSameOrigin(origin, req.headers.host);
        if (sameOrigin || allowlist.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
            res.setHeader(
                'Access-Control-Allow-Headers',
                req.headers['access-control-request-headers'] || 'Authorization,Content-Type,X-Requested-With'
            );
            res.setHeader('Access-Control-Max-Age', '600');
        } else {
            // Cross-origin and not in allowlist: block state-changing methods.
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return res.status(403).json({ error: 'Origin not allowed' });
            }
        }
    }
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Static files - disable etag to prevent stale module caching during development
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: false }));

// Ensure data directories exist
const dirs = [config.dataDir, config.jarsCache, config.serversRoot, 'logs'];
for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
    }
}

// Initialize all managers
const serverManager = new ServerManager();
const systemMonitor = new SystemMonitor();
const activityLog = new ActivityLog();
const backupManager = new BackupManager(activityLog);
const jobManager = new JobManager();
const scheduler = new Scheduler(serverManager, backupManager, activityLog, null); // networkManager set after creation
const notificationManager = new NotificationManager();
const apiKeyManager = new ApiKeyManager();
const userStore = new UserStore();
const twoFactorManager = new TwoFactorManager();
const permissionManager = new PermissionManager();
const resourceLimiter = new ResourceLimiter(serverManager);
const sftpServer = new SFTPServer(serverManager, permissionManager, userStore);
const revokedTokenStore = new RevokedTokenStore();
const networkManager = new NetworkManager(serverManager);
serverManager.setNetworkManager(networkManager);
const healthMonitor = new HealthMonitor(serverManager, networkManager);
const dnsManager = new DnsManager(networkManager);
networkManager.setHealthMonitor(healthMonitor);
networkManager.setDnsManager(dnsManager);
scheduler.networkManager = networkManager;
const statsCollector = new StatsCollector(serverManager, systemMonitor);

// Make managers available to routes
app.locals.serverManager = serverManager;
app.locals.systemMonitor = systemMonitor;
app.locals.activityLog = activityLog;
app.locals.backupManager = backupManager;
app.locals.jobManager = jobManager;
app.locals.scheduler = scheduler;
app.locals.notificationManager = notificationManager;
app.locals.apiKeyManager = apiKeyManager;
app.locals.userStore = userStore;
app.locals.twoFactorManager = twoFactorManager;
app.locals.permissionManager = permissionManager;
app.locals.resourceLimiter = resourceLimiter;
app.locals.sftpServer = sftpServer;
app.locals.revokedTokenStore = revokedTokenStore;
app.locals.networkManager = networkManager;
app.locals.healthMonitor = healthMonitor;
app.locals.dnsManager = dnsManager;
app.locals.statsCollector = statsCollector;

// API routes
const api = express.Router();
api.use('/auth', require('./routes/auth'));
api.use('/servers', require('./routes/servers'));
api.use('/jars', require('./routes/jars'));
api.use('/servers', require('./routes/files'));
api.use('/servers', require('./routes/players'));
api.use('/servers', require('./routes/backups'));
api.use('/servers', require('./routes/plugins'));
api.use('/servers', require('./routes/logs'));
api.use('/stats', require('./routes/stats'));
api.use('/activity', require('./routes/activity'));
api.use('/schedule', require('./routes/scheduler'));
api.use('/notifications', require('./routes/notifications'));
api.use('/keys', require('./routes/apikeys'));
api.use('/2fa', require('./routes/twofactor'));
api.use('/permissions', require('./routes/permissions'));
api.use('/resources', require('./routes/resources'));
api.use('/sftp', require('./routes/sftp'));
api.use('/startup', require('./routes/startup'));
api.use('/networks', require('./routes/networks'));
api.use('/health', require('./routes/health'));
api.use('/dns', require('./routes/dns'));
api.use('/templates', require('./routes/templates'));
api.use('/jobs', require('./routes/jobs'));

app.use('/api', api);
app.use('/api/v1', api);

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found', requestId: req.requestId });
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
    logger.error(`[${req.requestId}] Unhandled error: ${err.message}`);
    if (res.headersSent) return next(err);
    const payload = {
        error: err.expose ? err.message : 'Internal server error',
        requestId: req.requestId
    };
    if (err.details) payload.details = err.details;
    return res.status(err.status || 500).json(payload);
});

// Start panel
async function start() {
    await serverManager.loadServers();
    await networkManager.loadNetworks();
    await dnsManager.loadProviders();

    // Setup WebSocket & System Monitor
    setupWebSocket(server, serverManager, systemMonitor, resourceLimiter, networkManager, healthMonitor, permissionManager, jobManager);
    systemMonitor.start(serverManager);

    // Wire activity logging to server events
    serverManager.on('status', (data) => {
        if (data.status === 'running' && data.previousStatus === 'starting') {
            const s = serverManager.getServer(data.serverId);
            activityLog.log('server.start', { serverId: data.serverId, serverName: s?.name });
        } else if (data.status === 'stopped') {
            const s = serverManager.getServer(data.serverId);
            activityLog.log('server.stop', { serverId: data.serverId, serverName: s?.name });
        }
    });
    serverManager.on('player-join', (data) => {
        const s = serverManager.getServer(data.serverId);
        activityLog.log('player.join', { serverId: data.serverId, serverName: s?.name, player: data.player });
    });
    serverManager.on('player-leave', (data) => {
        const s = serverManager.getServer(data.serverId);
        activityLog.log('player.leave', { serverId: data.serverId, serverName: s?.name, player: data.player });
    });

    // Wire crash detection to activity log
    serverManager.on('crash', (data) => {
        const s = serverManager.getServer(data.serverId);
        activityLog.log('server.crash', {
            serverId: data.serverId,
            serverName: s?.name,
            exitCode: data.exitCode,
            crashCount: data.crashCount,
            willRestart: data.willRestart
        });
    });
    serverManager.on('max-crashes', (data) => {
        const s = serverManager.getServer(data.serverId);
        activityLog.log('server.max-crashes', {
            serverId: data.serverId,
            serverName: s?.name,
            crashCount: data.crashCount,
            maxAutoRestarts: data.maxAutoRestarts
        });
    });

    // Wire notifications to events
    notificationManager.attach(serverManager, backupManager);

    // Start health monitor
    healthMonitor.start();

    // Start stats collector
    statsCollector.start();

    // Start scheduler
    scheduler.start();

    // Start resource limiter
    resourceLimiter.start();

    // Restore resource limits from server configs
    for (const [id, instance] of serverManager.servers) {
        if (instance.config.resourceLimits) {
            resourceLimiter.setLimits(id, instance.config.resourceLimits);
        }
    }

    // Start SFTP server
    try {
        sftpServer.start();
    } catch (e) {
        logger.warn(`SFTP server failed to start: ${e.message}`);
    }

    // Enable console log persistence
    setupConsolePersistence(serverManager);

    server.listen(config.port, () => {
        logger.info(`FortunaPanel started on http://localhost:${config.port}`);
    });

    // Auto-start servers (skip suspended)
    await serverManager.autoStartServers();
}

// Console log persistence - save console output to disk
function setupConsolePersistence(serverManager) {
    const logsDir = path.join(config.dataDir, 'console-logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    // Track write streams per server
    const streams = new Map();

    function getStream(serverId) {
        if (streams.has(serverId)) return streams.get(serverId);

        const serverLogDir = path.join(logsDir, serverId);
        if (!fs.existsSync(serverLogDir)) {
            fs.mkdirSync(serverLogDir, { recursive: true });
        }

        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(serverLogDir, `${today}.log`);
        const stream = fs.createWriteStream(logFile, { flags: 'a' });
        streams.set(serverId, { stream, date: today });
        return { stream, date: today };
    }

    serverManager.on('console', (data) => {
        const today = new Date().toISOString().split('T')[0];
        let { stream, date } = getStream(data.serverId);

        // Rotate if day changed
        if (date !== today) {
            stream.end();
            streams.delete(data.serverId);
            ({ stream } = getStream(data.serverId));
        }

        const timestamp = new Date(data.timestamp).toISOString();
        stream.write(`[${timestamp}] [${data.level}] ${data.line}\n`);
    });

    // Cleanup streams on server stop
    serverManager.on('status', (data) => {
        if (data.status === 'stopped') {
            const entry = streams.get(data.serverId);
            if (entry) {
                entry.stream.end();
                streams.delete(data.serverId);
            }
        }
    });

    logger.info('Console log persistence enabled');
}

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down FortunaPanel (${signal})...`);
    try { healthMonitor.stop(); } catch (_) {}
    try { statsCollector.stop(); } catch (_) {}
    try { scheduler.stop(); } catch (_) {}
    try { resourceLimiter.stop(); } catch (_) {}
    try { sftpServer.stop(); } catch (_) {}
    try { revokedTokenStore.stop(); } catch (_) {}
    try { apiKeyManager.flush?.(); } catch (_) {}
    try { await serverManager.shutdownAll(); } catch (_) {}
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
    // Hard exit if close() hangs.
    setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Auto-start when running directly (not in Electron)
if (!process.versions.electron) {
    start().catch(err => {
        logger.error(`Failed to start: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { app, server, serverManager, start };
