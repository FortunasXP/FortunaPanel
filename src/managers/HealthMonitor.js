const net = require('net');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class HealthMonitor extends EventEmitter {
    constructor(serverManager, networkManager) {
        super();
        this.serverManager = serverManager;
        this.networkManager = networkManager;
        this._intervals = new Map(); // networkId -> timer
        this._health = new Map();    // serverId -> health state
    }

    start() {
        const networks = this.networkManager.getAllNetworks();
        for (const network of networks) {
            if (network.healthCheck?.enabled) {
                this._startMonitoring(network);
            }
        }
        logger.info(`HealthMonitor started for ${this._intervals.size} network(s)`);
    }

    stop() {
        for (const [id, timer] of this._intervals) {
            clearInterval(timer);
        }
        this._intervals.clear();
        this._health.clear();
        logger.info('HealthMonitor stopped');
    }

    reconfigure(networkId) {
        // Stop existing monitoring for this network
        const existing = this._intervals.get(networkId);
        if (existing) {
            clearInterval(existing);
            this._intervals.delete(networkId);
        }

        const network = this.networkManager.getNetwork(networkId);
        if (network?.healthCheck?.enabled) {
            this._startMonitoring(network);
        } else {
            // Clear health states for backends in this network
            if (network) {
                for (const backendId of (network.backendIds || [])) {
                    this._health.delete(backendId);
                }
            }
        }
    }

    getHealth(serverId) {
        return this._health.get(serverId) || { status: 'unknown', lastCheck: null, consecutiveFailures: 0 };
    }

    getNetworkHealth(networkId) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network) return {};

        const result = {};
        for (const backendId of (network.backendIds || [])) {
            result[backendId] = this.getHealth(backendId);
        }
        return result;
    }

    _startMonitoring(network) {
        const interval = (network.healthCheck.intervalSeconds || 30) * 1000;

        const check = () => this._checkNetwork(network.id);
        const timer = setInterval(check, interval);
        this._intervals.set(network.id, timer);

        // Run first check immediately
        check();

        logger.info(`Health monitoring started for network "${network.name}" (every ${network.healthCheck.intervalSeconds || 30}s)`);
    }

    async _checkNetwork(networkId) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network || !network.healthCheck?.enabled) {
            this.reconfigure(networkId);
            return;
        }

        for (const backendId of (network.backendIds || [])) {
            const server = this.serverManager.getServer(backendId);
            if (!server || server.status !== 'running') {
                // Only track health for running servers
                const current = this._health.get(backendId);
                if (current && current.status !== 'unknown') {
                    this._health.set(backendId, {
                        ...current,
                        status: 'unknown',
                        lastCheck: new Date().toISOString()
                    });
                }
                continue;
            }

            const healthy = await this._tcpPing(server.config.port);
            this._updateHealth(backendId, networkId, healthy, network.healthCheck);
        }
    }

    _tcpPing(port) {
        return new Promise((resolve) => {
            const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 5000 });

            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });

            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
        });
    }

    _updateHealth(serverId, networkId, healthy, healthConfig) {
        const current = this._health.get(serverId) || {
            status: 'unknown',
            lastCheck: null,
            consecutiveFailures: 0,
            lastFailure: null,
            lastRecovery: null
        };

        const previousStatus = current.status;
        const now = new Date().toISOString();

        if (healthy) {
            const newState = {
                status: 'healthy',
                lastCheck: now,
                consecutiveFailures: 0,
                lastFailure: current.lastFailure,
                lastRecovery: previousStatus === 'unhealthy' ? now : current.lastRecovery
            };
            this._health.set(serverId, newState);

            if (previousStatus === 'unhealthy') {
                logger.info(`Server ${serverId} recovered (network: ${networkId})`);
                this.emit('health-changed', {
                    serverId,
                    networkId,
                    status: 'healthy',
                    previousStatus,
                    consecutiveFailures: 0
                });
            }
        } else {
            const failures = current.consecutiveFailures + 1;
            const threshold = healthConfig.failureThreshold || 3;
            const isUnhealthy = failures >= threshold;

            const newState = {
                status: isUnhealthy ? 'unhealthy' : current.status === 'unhealthy' ? 'unhealthy' : 'healthy',
                lastCheck: now,
                consecutiveFailures: failures,
                lastFailure: now,
                lastRecovery: current.lastRecovery
            };
            this._health.set(serverId, newState);

            if (isUnhealthy && previousStatus !== 'unhealthy') {
                logger.warn(`Server ${serverId} is unhealthy (${failures} failures, network: ${networkId})`);
                this.emit('health-changed', {
                    serverId,
                    networkId,
                    status: 'unhealthy',
                    previousStatus,
                    consecutiveFailures: failures
                });

                // Auto-restart if enabled
                if (healthConfig.autoRestart) {
                    this._triggerAutoRestart(serverId, networkId);
                }
            }
        }
    }

    async _triggerAutoRestart(serverId, networkId) {
        try {
            const server = this.serverManager.getServer(serverId);
            if (!server || server.status !== 'running') return;

            logger.info(`Auto-restarting unhealthy server ${serverId} (network: ${networkId})`);
            this.emit('auto-restart-triggered', { serverId, networkId });

            await this.serverManager.restartServer(serverId);
        } catch (e) {
            logger.error(`Auto-restart failed for server ${serverId}: ${e.message}`);
        }
    }
}

module.exports = HealthMonitor;
