const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');
const { isProxyType } = require('../services/serverDetector');
const proxyConfig = require('../services/proxyConfigGenerator');

const REGISTRY_PATH = path.join(config.dataDir, 'networks.json');

class NetworkManager extends EventEmitter {
    constructor(serverManager) {
        super();
        this.serverManager = serverManager;
        this.networks = new Map();
        this.healthMonitor = null;
        this.dnsManager = null;
    }

    setHealthMonitor(hm) {
        this.healthMonitor = hm;
    }

    setDnsManager(dm) {
        this.dnsManager = dm;
    }

    async loadNetworks() {
        if (!fs.existsSync(REGISTRY_PATH)) {
            fs.writeFileSync(REGISTRY_PATH, '[]');
            return;
        }

        try {
            const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
            for (const net of data) {
                this.networks.set(net.id, net);
                logger.info(`Loaded network: ${net.name} (${net.id})`);
            }
            logger.info(`Loaded ${this.networks.size} network(s) from registry`);
        } catch (err) {
            logger.error(`Failed to load network registry: ${err.message}`);
        }
    }

    async createNetwork({ name, proxyId, proxyType }) {
        const proxy = this.serverManager.getServer(proxyId);
        if (!proxy) throw new Error('Proxy server not found');

        if (!isProxyType(proxy.config.type)) {
            throw new Error(`Server "${proxy.name}" is not a proxy type (${proxy.config.type})`);
        }

        // Check if proxy is already in a network
        const existing = this.getNetworkForServer(proxyId);
        if (existing) {
            throw new Error(`Server "${proxy.name}" is already part of network "${existing.name}"`);
        }

        const id = uuidv4();
        const network = {
            id,
            name: name || `${proxy.name} Network`,
            proxyId,
            proxyType: proxyType || proxy.config.type,
            backendIds: [],
            backendAliases: {},
            defaultServer: null,
            forwardingSecret: proxyConfig.generateForwardingSecret(),
            forwardingMode: proxy.config.type === 'velocity' ? 'modern' : 'ip_forward',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.networks.set(id, network);

        // Generate initial proxy config
        this._syncProxyConfig(network, proxy, []);

        await this.saveRegistry();
        logger.info(`Created network: ${network.name} (${id})`);
        this.emit('network-created', { networkId: id, name: network.name });
        return network;
    }

    async deleteNetwork(id) {
        const network = this.networks.get(id);
        if (!network) throw new Error('Network not found');

        // Reset all backend configs
        for (const backendId of (network.backendIds || [])) {
            const backend = this.serverManager.getServer(backendId);
            if (backend) {
                try {
                    proxyConfig.resetBackendConfig(backend.config.directory);
                } catch (e) {
                    logger.warn(`Failed to reset backend config for ${backend.name}: ${e.message}`);
                }
            }
        }

        this.networks.delete(id);
        await this.saveRegistry();
        logger.info(`Deleted network: ${network.name} (${id})`);
        this.emit('network-deleted', { networkId: id, name: network.name });
    }

    async addBackend(networkId, serverId, alias) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        const backend = this.serverManager.getServer(serverId);
        if (!backend) throw new Error('Server not found');

        // Validate server is not a proxy type
        if (isProxyType(backend.config.type)) {
            throw new Error('Cannot add a proxy server as a backend');
        }

        // Validate server is not already in any network
        const existingNetwork = this.getNetworkForServer(serverId);
        if (existingNetwork) {
            throw new Error(`Server "${backend.name}" is already part of network "${existingNetwork.name}"`);
        }

        // Validate alias is unique within this network
        const safeAlias = (alias || backend.name).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const existingAliases = Object.values(network.backendAliases);
        if (existingAliases.includes(safeAlias)) {
            throw new Error(`Alias "${safeAlias}" is already used in this network`);
        }

        // Add backend
        network.backendIds.push(serverId);
        network.backendAliases[serverId] = safeAlias;

        // Set as default if first backend
        if (!network.defaultServer) {
            network.defaultServer = serverId;
        }

        network.updatedAt = new Date().toISOString();

        // Configure backend for proxy forwarding
        if (network.proxyType === 'velocity') {
            proxyConfig.configureBackendForVelocity(backend.config.directory, network.forwardingSecret);
        } else {
            proxyConfig.configureBackendForBungee(backend.config.directory);
        }

        // Regenerate proxy config
        await this.syncProxyConfig(networkId);
        await this.saveRegistry();

        // Auto-sync DNS if enabled
        if (network.dns?.autoSync && this.dnsManager) {
            try { await this.dnsManager.syncNetworkDns(networkId); } catch (e) {
                logger.warn(`DNS auto-sync failed after adding backend: ${e.message}`);
            }
        }

        logger.info(`Added backend "${backend.name}" (as "${safeAlias}") to network "${network.name}"`);
        this.emit('backend-added', { networkId, serverId, alias: safeAlias });
        return network;
    }

    async removeBackend(networkId, serverId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        const idx = network.backendIds.indexOf(serverId);
        if (idx === -1) throw new Error('Server is not part of this network');

        const alias = network.backendAliases[serverId];

        // Remove from arrays
        network.backendIds.splice(idx, 1);
        delete network.backendAliases[serverId];

        // Update default server if needed
        if (network.defaultServer === serverId) {
            network.defaultServer = network.backendIds[0] || null;
        }

        network.updatedAt = new Date().toISOString();

        // Reset backend config
        const backend = this.serverManager.getServer(serverId);
        if (backend) {
            proxyConfig.resetBackendConfig(backend.config.directory);
        }

        // Regenerate proxy config
        await this.syncProxyConfig(networkId);
        await this.saveRegistry();

        // Auto-sync DNS if enabled
        if (network.dns?.autoSync && this.dnsManager) {
            try { await this.dnsManager.syncNetworkDns(networkId); } catch (e) {
                logger.warn(`DNS auto-sync failed after removing backend: ${e.message}`);
            }
        }

        logger.info(`Removed backend "${alias}" from network "${network.name}"`);
        this.emit('backend-removed', { networkId, serverId, alias });
        return network;
    }

    async setDefaultServer(networkId, serverId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        if (!network.backendIds.includes(serverId)) {
            throw new Error('Server is not part of this network');
        }

        network.defaultServer = serverId;
        network.updatedAt = new Date().toISOString();

        // Regenerate proxy config to update try order
        await this.syncProxyConfig(networkId);
        await this.saveRegistry();

        return network;
    }

    async updateNetwork(networkId, updates) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        if (updates.name !== undefined) network.name = updates.name;
        if (updates.forwardingMode !== undefined) {
            network.forwardingMode = updates.forwardingMode;
            // Re-sync all configs when forwarding mode changes
            await this.syncAllConfigs(networkId);
        }
        if (updates.defaultServer !== undefined) {
            if (updates.defaultServer && !network.backendIds.includes(updates.defaultServer)) {
                throw new Error('Server is not part of this network');
            }
            network.defaultServer = updates.defaultServer;
        }
        if (updates.bootOrder !== undefined) {
            network.bootOrder = updates.bootOrder;
        }
        if (updates.healthCheck !== undefined) {
            network.healthCheck = { ...network.healthCheck, ...updates.healthCheck };
            if (this.healthMonitor) {
                this.healthMonitor.reconfigure(networkId);
            }
        }

        network.updatedAt = new Date().toISOString();
        await this.saveRegistry();
        return network;
    }

    async syncProxyConfig(networkId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        const proxy = this.serverManager.getServer(network.proxyId);
        if (!proxy) {
            logger.warn(`Proxy server not found for network ${network.name}`);
            return;
        }

        const backends = network.backendIds
            .map(id => this.serverManager.getServer(id))
            .filter(Boolean);

        this._syncProxyConfig(network, proxy, backends);
    }

    _syncProxyConfig(network, proxy, backends) {
        const maintenanceServers = this._getMaintenanceSet(network);

        // Build forced hosts map from DNS config
        const forcedHosts = {};
        if (network.dns?.forcedHosts) {
            for (const [serverId, mapping] of Object.entries(network.dns.forcedHosts)) {
                const alias = (network.backendAliases || {})[serverId];
                if (alias && mapping.fqdn) {
                    forcedHosts[mapping.fqdn] = [alias];
                }
            }
        }

        const options = { maintenanceServers, forcedHosts };

        if (network.proxyType === 'velocity') {
            proxyConfig.generateVelocityConfig(network, proxy, backends, options);
        } else {
            proxyConfig.generateBungeeConfig(network, proxy, backends, options);
        }
    }

    async syncAllConfigs(networkId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        // Sync proxy config
        await this.syncProxyConfig(networkId);

        // Sync all backend configs
        for (const backendId of network.backendIds) {
            const backend = this.serverManager.getServer(backendId);
            if (!backend) continue;

            if (network.proxyType === 'velocity') {
                proxyConfig.configureBackendForVelocity(backend.config.directory, network.forwardingSecret);
            } else {
                proxyConfig.configureBackendForBungee(backend.config.directory);
            }
        }

        logger.info(`Synced all configs for network ${network.name}`);
    }

    async regenerateSecret(networkId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        network.forwardingSecret = proxyConfig.generateForwardingSecret();
        network.updatedAt = new Date().toISOString();

        // Re-sync everything with new secret
        await this.syncAllConfigs(networkId);
        await this.saveRegistry();

        return network;
    }

    async startNetwork(networkId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        const maintenanceSet = this._getMaintenanceSet(network);

        // Use boot order if defined, otherwise start all in parallel
        const bootOrder = network.bootOrder || [network.backendIds];

        for (const group of bootOrder) {
            const groupPromises = [];
            const groupIds = [];
            for (const backendId of group) {
                if (maintenanceSet.has(backendId)) continue;
                const backend = this.serverManager.getServer(backendId);
                if (backend && backend.status === 'stopped') {
                    groupPromises.push(this.serverManager.startServer(backendId));
                    groupIds.push(backendId);
                }
            }
            if (groupPromises.length > 0) {
                await Promise.all(groupPromises);
                await this._waitForServersRunning(groupIds, 60000);
            }
        }

        // Then start the proxy
        const proxy = this.serverManager.getServer(network.proxyId);
        if (proxy && proxy.status === 'stopped') {
            await this.serverManager.startServer(network.proxyId);
        }

        logger.info(`Started network: ${network.name}`);
        this.emit('network-started', { networkId, name: network.name });
    }

    async rollingRestart(networkId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        const maintenanceSet = this._getMaintenanceSet(network);
        const order = network.bootOrder
            ? network.bootOrder.flat()
            : [...(network.backendIds || [])];

        const activeIds = order.filter(id => !maintenanceSet.has(id));

        this.emit('rolling-restart-started', { networkId, name: network.name, total: activeIds.length });

        for (let i = 0; i < activeIds.length; i++) {
            const backendId = activeIds[i];
            const backend = this.serverManager.getServer(backendId);
            if (!backend) continue;

            this.emit('rolling-restart-progress', { networkId, serverId: backendId, index: i, total: activeIds.length });

            if (backend.status === 'running') {
                await this.serverManager.restartServer(backendId);
                await this._waitForServersRunning([backendId], 120000);
                // Stabilization delay
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        this.emit('rolling-restart-completed', { networkId, name: network.name });
        logger.info(`Rolling restart completed for network: ${network.name}`);
    }

    async setMaintenanceMode(networkId, serverId, enabled, reason = '') {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');
        if (!(network.backendIds || []).includes(serverId)) throw new Error('Server not in network');

        if (!network.maintenance) network.maintenance = { servers: {} };

        if (enabled) {
            network.maintenance.servers[serverId] = {
                enabled: true,
                enabledAt: new Date().toISOString(),
                reason
            };
        } else {
            delete network.maintenance.servers[serverId];
        }

        network.updatedAt = new Date().toISOString();

        // Re-sync proxy config (excludes maintenance servers)
        await this.syncProxyConfig(networkId);
        await this.saveRegistry();

        this.emit('maintenance-changed', { networkId, serverId, enabled, reason });
        return network;
    }

    _getMaintenanceSet(network) {
        const set = new Set();
        if (network.maintenance?.servers) {
            for (const [id, info] of Object.entries(network.maintenance.servers)) {
                if (info.enabled) set.add(id);
            }
        }
        return set;
    }

    async stopNetwork(networkId) {
        const network = this.networks.get(networkId);
        if (!network) throw new Error('Network not found');

        // Stop proxy first
        const proxy = this.serverManager.getServer(network.proxyId);
        if (proxy && proxy.process) {
            await this.serverManager.stopServer(network.proxyId);
        }

        // Then stop all backends (in parallel)
        const backendPromises = [];
        for (const backendId of network.backendIds) {
            const backend = this.serverManager.getServer(backendId);
            if (backend && backend.process) {
                backendPromises.push(this.serverManager.stopServer(backendId));
            }
        }

        if (backendPromises.length > 0) {
            await Promise.all(backendPromises);
        }

        logger.info(`Stopped network: ${network.name}`);
        this.emit('network-stopped', { networkId, name: network.name });
    }

    _waitForServersRunning(serverIds, timeout) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                const allRunning = serverIds.every(id => {
                    const s = this.serverManager.getServer(id);
                    return !s || s.status === 'running';
                });

                // Check if any server failed to start (crashed back to stopped)
                const anyFailed = serverIds.some(id => {
                    const s = this.serverManager.getServer(id);
                    return s && s.status === 'stopped';
                });

                if (allRunning) {
                    resolve();
                } else if (anyFailed) {
                    reject(new Error('One or more backend servers failed to start'));
                } else if (Date.now() - start > timeout) {
                    reject(new Error('Timed out waiting for backend servers to start'));
                } else {
                    setTimeout(check, 1000);
                }
            };
            check();
        });
    }

    // Lookups

    getNetwork(id) {
        return this.networks.get(id);
    }

    getAllNetworks() {
        return Array.from(this.networks.values());
    }

    getNetworkForServer(serverId) {
        for (const network of this.networks.values()) {
            if (network.proxyId === serverId || (network.backendIds || []).includes(serverId)) {
                return network;
            }
        }
        return null;
    }

    getNetworkDetail(id) {
        const network = this.networks.get(id);
        if (!network) return null;

        const proxy = this.serverManager.getServer(network.proxyId);
        const healthData = this.healthMonitor ? this.healthMonitor.getNetworkHealth(id) : {};

        const backends = (network.backendIds || []).map(bid => {
            const backend = this.serverManager.getServer(bid);
            const base = backend ? {
                ...backend.getStatus(),
                alias: (network.backendAliases || {})[bid],
                isDefault: network.defaultServer === bid
            } : { id: bid, alias: (network.backendAliases || {})[bid], status: 'unknown', missing: true };

            return {
                ...base,
                health: healthData[bid] || { status: 'unknown' },
                maintenance: network.maintenance?.servers?.[bid] || null
            };
        });

        const configContent = proxy
            ? proxyConfig.readProxyConfig(network.proxyType, proxy.config.directory)
            : null;

        return {
            ...network,
            proxy: proxy ? proxy.getStatus() : { id: network.proxyId, status: 'unknown', missing: true },
            backends,
            configContent,
            totalPlayers: (proxy ? (proxy.players?.size || 0) : 0),
            allRunning: proxy?.status === 'running' && backends.every(b => b.status === 'running' && !b.maintenance)
        };
    }

    // Persistence

    async saveRegistry() {
        const data = Array.from(this.networks.values());
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
    }
}

module.exports = NetworkManager;
