const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');

const STORE_PATH = path.join(config.dataDir, 'nodes.json');

// Node status constants
const STATUS = {
    ONLINE: 'online',
    OFFLINE: 'offline',
    CONNECTING: 'connecting',
    ERROR: 'error'
};

class NodeManager extends EventEmitter {
    constructor(serverManager) {
        super();
        this.serverManager = serverManager;
        this._nodes = this._load();
        this._connections = new Map(); // nodeId -> ws connection
        this._heartbeats = new Map(); // nodeId -> last heartbeat timestamp
        this._heartbeatInterval = null;
    }

    /**
     * Start heartbeat monitoring.
     */
    start() {
        this._heartbeatInterval = setInterval(() => this._checkHeartbeats(), 30000);
        logger.info(`NodeManager started with ${this._nodes.length} registered node(s)`);
    }

    stop() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
        // Close all agent connections
        for (const [nodeId, ws] of this._connections) {
            try { ws.close(); } catch (_) {}
        }
        this._connections.clear();
    }

    // --- Node Registration ---

    /**
     * Register a new remote node and generate its connection token.
     */
    registerNode({ name, host, description = '' }) {
        if (!name) throw new Error('Node name is required');

        const id = crypto.randomUUID();
        const token = crypto.randomBytes(32).toString('base64url');

        const node = {
            id,
            name,
            host: host || null,
            description,
            token, // Agent uses this to authenticate
            status: STATUS.OFFLINE,
            registeredAt: new Date().toISOString(),
            lastSeen: null,
            systemInfo: null,
            serverCount: 0
        };

        this._nodes.push(node);
        this._save();
        logger.info(`Node registered: ${name} (${id})`);
        return node;
    }

    /**
     * Remove a node.
     */
    removeNode(nodeId) {
        const idx = this._nodes.findIndex(n => n.id === nodeId);
        if (idx === -1) throw new Error('Node not found');

        // Check for servers on this node
        const nodeServers = this._getNodeServers(nodeId);
        if (nodeServers.length > 0) {
            throw new Error(`Cannot remove node with ${nodeServers.length} server(s). Migrate them first.`);
        }

        const ws = this._connections.get(nodeId);
        if (ws) {
            try { ws.close(); } catch (_) {}
            this._connections.delete(nodeId);
        }

        const node = this._nodes[idx];
        this._nodes.splice(idx, 1);
        this._save();
        logger.info(`Node removed: ${node.name}`);
        return true;
    }

    /**
     * Update node info.
     */
    updateNode(nodeId, updates) {
        const node = this._nodes.find(n => n.id === nodeId);
        if (!node) throw new Error('Node not found');

        if (updates.name) node.name = updates.name;
        if (updates.host !== undefined) node.host = updates.host;
        if (updates.description !== undefined) node.description = updates.description;

        this._save();
        return node;
    }

    /**
     * Regenerate a node's connection token.
     */
    regenerateToken(nodeId) {
        const node = this._nodes.find(n => n.id === nodeId);
        if (!node) throw new Error('Node not found');

        node.token = crypto.randomBytes(32).toString('base64url');
        this._save();

        // Disconnect existing connection
        const ws = this._connections.get(nodeId);
        if (ws) {
            try { ws.close(); } catch (_) {}
            this._connections.delete(nodeId);
        }

        logger.info(`Token regenerated for node: ${node.name}`);
        return node;
    }

    // --- Agent Connection Handling ---

    /**
     * Authenticate an incoming agent WebSocket connection.
     */
    authenticateAgent(token) {
        return this._nodes.find(n => n.token === token) || null;
    }

    /**
     * Register an active WebSocket connection from an agent.
     */
    connectAgent(nodeId, ws) {
        const node = this._nodes.find(n => n.id === nodeId);
        if (!node) return false;

        this._connections.set(nodeId, ws);
        this._heartbeats.set(nodeId, Date.now());
        node.status = STATUS.ONLINE;
        node.lastSeen = new Date().toISOString();
        this._save();

        this.emit('node-online', { nodeId, name: node.name });
        logger.info(`Agent connected: ${node.name}`);

        ws.on('close', () => {
            this._connections.delete(nodeId);
            this._heartbeats.delete(nodeId);
            node.status = STATUS.OFFLINE;
            this._save();
            this.emit('node-offline', { nodeId, name: node.name });
            logger.info(`Agent disconnected: ${node.name}`);
        });

        return true;
    }

    /**
     * Handle heartbeat from an agent.
     */
    handleHeartbeat(nodeId, data) {
        this._heartbeats.set(nodeId, Date.now());
        const node = this._nodes.find(n => n.id === nodeId);
        if (node) {
            node.lastSeen = new Date().toISOString();
            node.systemInfo = data.systemInfo || node.systemInfo;
            node.serverCount = data.serverCount ?? node.serverCount;
        }
    }

    /**
     * Send a command to a remote agent.
     */
    sendToAgent(nodeId, message) {
        const ws = this._connections.get(nodeId);
        if (!ws || ws.readyState !== 1) {
            throw new Error('Agent not connected');
        }
        ws.send(JSON.stringify(message));
    }

    /**
     * Check if a node is online.
     */
    isOnline(nodeId) {
        return this._connections.has(nodeId) &&
               this._connections.get(nodeId).readyState === 1;
    }

    // --- Queries ---

    /**
     * List all nodes with live status.
     */
    listNodes() {
        return this._nodes.map(n => ({
            id: n.id,
            name: n.name,
            host: n.host,
            description: n.description,
            status: this.isOnline(n.id) ? STATUS.ONLINE : STATUS.OFFLINE,
            registeredAt: n.registeredAt,
            lastSeen: n.lastSeen,
            systemInfo: n.systemInfo,
            serverCount: n.serverCount
        }));
    }

    /**
     * Get a single node (includes token for admin display).
     */
    getNode(nodeId) {
        const node = this._nodes.find(n => n.id === nodeId);
        if (!node) return null;
        return {
            ...node,
            status: this.isOnline(nodeId) ? STATUS.ONLINE : STATUS.OFFLINE
        };
    }

    /**
     * Get the local node representation.
     */
    getLocalNode() {
        const os = require('os');
        return {
            id: 'local',
            name: os.hostname(),
            host: 'localhost',
            status: STATUS.ONLINE,
            systemInfo: {
                platform: process.platform,
                cpus: os.cpus().length,
                totalMemory: os.totalmem(),
                freeMemory: os.freemem(),
                uptime: os.uptime()
            },
            serverCount: this._getNodeServers(null).length
        };
    }

    // --- Internal ---

    _getNodeServers(nodeId) {
        const servers = [];
        for (const [, instance] of this.serverManager.servers) {
            const sNodeId = instance.config.nodeId || null;
            if (sNodeId === nodeId) {
                servers.push(instance);
            }
        }
        return servers;
    }

    _checkHeartbeats() {
        const timeout = 60000; // 60 seconds
        const now = Date.now();

        for (const [nodeId, lastBeat] of this._heartbeats) {
            if (now - lastBeat > timeout) {
                const node = this._nodes.find(n => n.id === nodeId);
                if (node && node.status === STATUS.ONLINE) {
                    node.status = STATUS.ERROR;
                    this._save();
                    this.emit('node-timeout', { nodeId, name: node?.name });
                    logger.warn(`Node heartbeat timeout: ${node?.name}`);
                }
            }
        }
    }

    _load() {
        try {
            if (fs.existsSync(STORE_PATH)) {
                return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            }
        } catch (e) {
            logger.warn(`Failed to load nodes: ${e.message}`);
        }
        return [];
    }

    _save() {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(this._nodes, null, 2));
        } catch (e) {
            logger.warn(`Failed to save nodes: ${e.message}`);
        }
    }
}

module.exports = NodeManager;
