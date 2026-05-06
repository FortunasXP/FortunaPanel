const net = require('net');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');

const STORE_PATH = path.join(config.dataDir, 'proxy-routes.json');

class ProxyManager extends EventEmitter {
    constructor(serverManager) {
        super();
        this.serverManager = serverManager;
        this._routes = this._load();
        this._servers = new Map(); // listenPort -> net.Server
        this._connections = new Map(); // listenPort -> Set<socket>
    }

    /**
     * Start all configured proxy routes.
     */
    start() {
        let started = 0;
        for (const route of this._routes) {
            if (route.enabled) {
                try {
                    this._startRoute(route);
                    started++;
                } catch (e) {
                    logger.warn(`Failed to start proxy route ${route.id}: ${e.message}`);
                }
            }
        }
        logger.info(`ProxyManager started with ${started} active route(s)`);
    }

    /**
     * Stop all proxy servers.
     */
    stop() {
        for (const [port, server] of this._servers) {
            this._closeServer(port, server);
        }
        this._servers.clear();
        this._connections.clear();
        logger.info('ProxyManager stopped');
    }

    /**
     * Add a new proxy route.
     */
    addRoute({ name, listenPort, targetHost, targetPort, serverId, enabled = true }) {
        if (!listenPort || !targetPort) {
            throw new Error('listenPort and targetPort are required');
        }
        if (this._routes.some(r => r.listenPort === listenPort)) {
            throw new Error(`Port ${listenPort} is already in use by another route`);
        }

        const id = require('crypto').randomUUID();
        const route = {
            id,
            name: name || `Proxy ${listenPort} → ${targetPort}`,
            listenPort,
            targetHost: targetHost || '127.0.0.1',
            targetPort,
            serverId: serverId || null,
            enabled,
            createdAt: new Date().toISOString(),
            connections: 0,
            totalConnections: 0
        };

        this._routes.push(route);
        this._save();

        if (enabled) {
            this._startRoute(route);
        }

        return route;
    }

    /**
     * Update an existing route.
     */
    updateRoute(routeId, updates) {
        const route = this._routes.find(r => r.id === routeId);
        if (!route) throw new Error('Route not found');

        const wasEnabled = route.enabled;
        const portChanged = updates.listenPort && updates.listenPort !== route.listenPort;

        // If port is changing, check for conflicts
        if (portChanged && this._routes.some(r => r.id !== routeId && r.listenPort === updates.listenPort)) {
            throw new Error(`Port ${updates.listenPort} is already in use`);
        }

        // Stop current if running and port/enabled changed
        if (wasEnabled && (portChanged || updates.enabled === false)) {
            this._stopRoute(route.listenPort);
        }

        Object.assign(route, {
            name: updates.name ?? route.name,
            listenPort: updates.listenPort ?? route.listenPort,
            targetHost: updates.targetHost ?? route.targetHost,
            targetPort: updates.targetPort ?? route.targetPort,
            serverId: updates.serverId !== undefined ? updates.serverId : route.serverId,
            enabled: updates.enabled ?? route.enabled
        });

        this._save();

        // Start if now enabled
        if (route.enabled && (!wasEnabled || portChanged)) {
            this._startRoute(route);
        }

        return route;
    }

    /**
     * Delete a route.
     */
    deleteRoute(routeId) {
        const idx = this._routes.findIndex(r => r.id === routeId);
        if (idx === -1) throw new Error('Route not found');

        const route = this._routes[idx];
        if (this._servers.has(route.listenPort)) {
            this._stopRoute(route.listenPort);
        }

        this._routes.splice(idx, 1);
        this._save();
        return true;
    }

    /**
     * List all routes with live connection counts.
     */
    listRoutes() {
        return this._routes.map(r => ({
            ...r,
            active: this._servers.has(r.listenPort),
            connections: this._connections.get(r.listenPort)?.size || 0
        }));
    }

    /**
     * Get a single route.
     */
    getRoute(routeId) {
        return this._routes.find(r => r.id === routeId) || null;
    }

    // --- Internal TCP proxy ---

    _startRoute(route) {
        if (this._servers.has(route.listenPort)) return;

        const connections = new Set();
        this._connections.set(route.listenPort, connections);

        const server = net.createServer((clientSocket) => {
            connections.add(clientSocket);
            route.totalConnections = (route.totalConnections || 0) + 1;

            const targetSocket = net.createConnection({
                host: route.targetHost,
                port: route.targetPort
            });

            // Pipe data bidirectionally
            clientSocket.pipe(targetSocket);
            targetSocket.pipe(clientSocket);

            const cleanup = () => {
                connections.delete(clientSocket);
                clientSocket.destroy();
                targetSocket.destroy();
            };

            clientSocket.on('error', cleanup);
            clientSocket.on('close', cleanup);
            targetSocket.on('error', cleanup);
            targetSocket.on('close', cleanup);
        });

        server.on('error', (err) => {
            logger.error(`Proxy route ${route.name} error: ${err.message}`);
            this._servers.delete(route.listenPort);
            this._connections.delete(route.listenPort);
        });

        server.listen(route.listenPort, () => {
            logger.info(`Proxy route "${route.name}" listening on :${route.listenPort} → ${route.targetHost}:${route.targetPort}`);
        });

        this._servers.set(route.listenPort, server);
    }

    _stopRoute(listenPort) {
        const server = this._servers.get(listenPort);
        if (server) {
            this._closeServer(listenPort, server);
            this._servers.delete(listenPort);
        }
        const conns = this._connections.get(listenPort);
        if (conns) {
            for (const sock of conns) {
                sock.destroy();
            }
            this._connections.delete(listenPort);
        }
    }

    _closeServer(port, server) {
        try {
            server.close();
            logger.info(`Proxy route on :${port} stopped`);
        } catch (e) {
            logger.warn(`Error closing proxy on :${port}: ${e.message}`);
        }
    }

    _load() {
        try {
            if (fs.existsSync(STORE_PATH)) {
                return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            }
        } catch (e) {
            logger.warn(`Failed to load proxy routes: ${e.message}`);
        }
        return [];
    }

    _save() {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(this._routes, null, 2));
        } catch (e) {
            logger.warn(`Failed to save proxy routes: ${e.message}`);
        }
    }
}

module.exports = ProxyManager;
