const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/default');
const logger = require('../utils/logger');
const dnsProviders = require('../services/dnsProviders');

const PROVIDERS_PATH = path.join(config.dataDir, 'dns-providers.json');
const ENCRYPTION_SALT = 'fortuna-dns-salt';

class DnsManager extends EventEmitter {
    constructor(networkManager) {
        super();
        this.networkManager = networkManager;
        this.providers = new Map();
        this._encryptionKey = crypto.scryptSync(config.jwtSecret, ENCRYPTION_SALT, 32);
    }

    async loadProviders() {
        if (!fs.existsSync(PROVIDERS_PATH)) {
            fs.writeFileSync(PROVIDERS_PATH, '[]');
            return;
        }
        try {
            const data = JSON.parse(fs.readFileSync(PROVIDERS_PATH, 'utf-8'));
            for (const p of data) {
                this.providers.set(p.id, p);
            }
            logger.info(`Loaded ${this.providers.size} DNS provider(s)`);
        } catch (e) {
            logger.error(`Failed to load DNS providers: ${e.message}`);
        }
    }

    _saveProviders() {
        const data = Array.from(this.providers.values());
        fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(data, null, 2));
    }

    // --- Encryption ---
    //
    // New format: AES-256-GCM with per-field IV and auth tag. The 'enc'
    // marker on the encrypted credentials object lets us migrate legacy
    // CBC ciphertext lazily — when we decrypt a v1 entry, we re-encrypt
    // as v2 on the next save.
    //
    // v1 (legacy CBC, no auth):  { encrypted: { key: hex }, iv: ivHex }
    // v2 (current GCM, AEAD):    { enc: 'gcm', credentials: { key: { ct, iv, tag } } }

    _encryptCredentials(credentials) {
        const encrypted = {};
        for (const [key, value] of Object.entries(credentials)) {
            const iv = crypto.randomBytes(12); // GCM standard: 96-bit IV
            const cipher = crypto.createCipheriv('aes-256-gcm', this._encryptionKey, iv);
            const ct = Buffer.concat([cipher.update(String(value), 'utf-8'), cipher.final()]);
            const tag = cipher.getAuthTag();
            encrypted[key] = {
                ct: ct.toString('hex'),
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            };
        }
        return { enc: 'gcm', credentials: encrypted };
    }

    _decryptCredentials(payload, ivHex) {
        // v2 format: payload = { enc: 'gcm', credentials: { key: {ct,iv,tag} } }
        if (payload && payload.enc === 'gcm' && payload.credentials) {
            const decrypted = {};
            for (const [key, blob] of Object.entries(payload.credentials)) {
                const iv = Buffer.from(blob.iv, 'hex');
                const tag = Buffer.from(blob.tag, 'hex');
                const ct = Buffer.from(blob.ct, 'hex');
                const decipher = crypto.createDecipheriv('aes-256-gcm', this._encryptionKey, iv);
                decipher.setAuthTag(tag);
                const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
                decrypted[key] = dec.toString('utf-8');
            }
            return decrypted;
        }

        // v1 legacy: AES-256-CBC, shared IV, no integrity tag. Decrypt so
        // existing installations keep working; the next save will re-emit
        // as v2.
        const encrypted = payload;
        const iv = Buffer.from(ivHex, 'hex');
        const decrypted = {};
        for (const [key, value] of Object.entries(encrypted || {})) {
            const decipher = crypto.createDecipheriv('aes-256-cbc', this._encryptionKey, iv);
            let dec = decipher.update(value, 'hex', 'utf-8');
            dec += decipher.final('utf-8');
            decrypted[key] = dec;
        }
        return decrypted;
    }

    // --- Provider CRUD ---

    addProvider({ name, type, credentials }) {
        const id = uuidv4().slice(0, 8);
        // v2 payload is self-contained — no separate credentialsIv field
        // because each field has its own IV + auth tag.
        const provider = {
            id,
            name,
            type,
            credentials: this._encryptCredentials(credentials),
            createdAt: new Date().toISOString(),
            lastTestedAt: null,
            testResult: null
        };

        this.providers.set(id, provider);
        this._saveProviders();
        this.emit('dns-provider-added', { id, name, type });
        logger.info(`Added DNS provider: ${name} (${type})`);
        return { id, name, type };
    }

    updateProvider(id, updates) {
        const provider = this.providers.get(id);
        if (!provider) throw new Error('DNS provider not found');

        if (updates.name) provider.name = updates.name;
        if (updates.credentials) {
            provider.credentials = this._encryptCredentials(updates.credentials);
            // Legacy CBC providers had a separate `credentialsIv` — drop
            // it on update so we never accidentally feed it into the v2
            // decrypt path.
            delete provider.credentialsIv;
            provider.testResult = null;
            provider.lastTestedAt = null;
        }

        this._saveProviders();
        return { id: provider.id, name: provider.name, type: provider.type };
    }

    removeProvider(id) {
        const provider = this.providers.get(id);
        if (!provider) throw new Error('DNS provider not found');

        // Check if any network uses this provider
        for (const network of this.networkManager.getAllNetworks()) {
            if (network.dns?.providerId === id) {
                throw new Error(`Provider is in use by network "${network.name}". Remove DNS config first.`);
            }
        }

        // Check if any individual server uses this provider
        const serverManager = this.networkManager.serverManager;
        if (serverManager) {
            for (const instance of serverManager.servers.values()) {
                if (instance.config?.dns?.providerId === id) {
                    throw new Error(`Provider is in use by server "${instance.name}". Remove DNS config first.`);
                }
            }
        }

        this.providers.delete(id);
        this._saveProviders();
        this.emit('dns-provider-removed', { id, name: provider.name });
        logger.info(`Removed DNS provider: ${provider.name}`);
    }

    async testProvider(id) {
        const provider = this.providers.get(id);
        if (!provider) throw new Error('DNS provider not found');

        const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);

        try {
            let result;
            if (provider.type === 'cloudflare') {
                result = await dnsProviders.cloudflare.testConnection(creds.apiToken, creds.zoneId);
            } else if (provider.type === 'route53') {
                result = await dnsProviders.route53.testConnection(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId);
            } else {
                throw new Error(`Unknown provider type: ${provider.type}`);
            }

            provider.lastTestedAt = new Date().toISOString();
            provider.testResult = 'ok';
            this._saveProviders();
            return { success: true, ...result };
        } catch (e) {
            provider.lastTestedAt = new Date().toISOString();
            provider.testResult = e.message;
            this._saveProviders();
            throw e;
        }
    }

    getProviders() {
        return Array.from(this.providers.values()).map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            lastTestedAt: p.lastTestedAt,
            testResult: p.testResult,
            createdAt: p.createdAt
        }));
    }

    getProvider(id) {
        const p = this.providers.get(id);
        if (!p) return null;
        return {
            id: p.id,
            name: p.name,
            type: p.type,
            lastTestedAt: p.lastTestedAt,
            testResult: p.testResult,
            createdAt: p.createdAt
        };
    }

    // --- Network DNS Configuration ---

    async configureNetworkDns(networkId, { providerId, baseDomain, serverIp, autoSync }) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network) throw new Error('Network not found');

        const provider = this.providers.get(providerId);
        if (!provider) throw new Error('DNS provider not found');

        const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
        const proxy = this.networkManager.serverManager.getServer(network.proxyId);
        const proxyPort = proxy?.config?.port || 25565;

        // Create DNS records
        const records = [];

        try {
            if (provider.type === 'cloudflare') {
                // A record for base domain
                const aRecord = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                    type: 'A',
                    name: baseDomain,
                    content: serverIp,
                    proxied: false
                });
                records.push({
                    id: uuidv4().slice(0, 8),
                    type: 'A',
                    name: baseDomain,
                    value: serverIp,
                    providerRecordId: aRecord.id,
                    managed: true
                });

                // SRV record for Minecraft
                const srvRecord = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                    type: 'SRV',
                    name: `_minecraft._tcp.${baseDomain}`,
                    data: {
                        service: '_minecraft',
                        proto: '_tcp',
                        name: baseDomain,
                        priority: 0,
                        weight: 5,
                        port: proxyPort,
                        target: baseDomain
                    }
                });
                records.push({
                    id: uuidv4().slice(0, 8),
                    type: 'SRV',
                    name: `_minecraft._tcp.${baseDomain}`,
                    value: `0 5 ${proxyPort} ${baseDomain}`,
                    providerRecordId: srvRecord.id,
                    managed: true
                });
            } else if (provider.type === 'route53') {
                await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                    { action: 'UPSERT', name: baseDomain, type: 'A', value: serverIp, ttl: 300 },
                    { action: 'UPSERT', name: `_minecraft._tcp.${baseDomain}`, type: 'SRV', value: `0 5 ${proxyPort} ${baseDomain}.`, ttl: 300 }
                ]);
                records.push(
                    { id: uuidv4().slice(0, 8), type: 'A', name: baseDomain, value: serverIp, providerRecordId: null, managed: true },
                    { id: uuidv4().slice(0, 8), type: 'SRV', name: `_minecraft._tcp.${baseDomain}`, value: `0 5 ${proxyPort} ${baseDomain}`, providerRecordId: null, managed: true }
                );
            }
        } catch (e) {
            throw new Error(`Failed to create DNS records: ${e.message}`);
        }

        // Store DNS config on network
        network.dns = {
            providerId,
            providerName: provider.name,
            providerType: provider.type,
            baseDomain,
            serverIp,
            autoSync: autoSync !== false,
            records,
            forcedHosts: {}
        };
        network.updatedAt = new Date().toISOString();

        await this.networkManager.saveRegistry();
        this.emit('dns-configured', { networkId, baseDomain });
        logger.info(`DNS configured for network ${network.name}: ${baseDomain}`);
        return network.dns;
    }

    async removeNetworkDns(networkId) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network || !network.dns) throw new Error('Network DNS not configured');

        const provider = this.providers.get(network.dns.providerId);
        if (provider) {
            const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);

            try {
                if (provider.type === 'cloudflare') {
                    // Delete all managed records
                    for (const record of (network.dns.records || [])) {
                        if (record.providerRecordId) {
                            try { await dnsProviders.cloudflare.deleteRecord(creds.apiToken, creds.zoneId, record.providerRecordId); } catch (e) {
                                logger.warn(`Failed to delete DNS record ${record.name}: ${e.message}`);
                            }
                        }
                    }
                    // Delete forced host records
                    for (const mapping of Object.values(network.dns.forcedHosts || {})) {
                        if (mapping.aRecordId) {
                            try { await dnsProviders.cloudflare.deleteRecord(creds.apiToken, creds.zoneId, mapping.aRecordId); } catch (e) {}
                        }
                        if (mapping.srvRecordId) {
                            try { await dnsProviders.cloudflare.deleteRecord(creds.apiToken, creds.zoneId, mapping.srvRecordId); } catch (e) {}
                        }
                    }
                } else if (provider.type === 'route53') {
                    const changes = [];
                    for (const record of (network.dns.records || [])) {
                        changes.push({ action: 'DELETE', name: record.name, type: record.type, value: record.value, ttl: 300 });
                    }
                    const proxy = this.networkManager.serverManager.getServer(network.proxyId);
                    const proxyPort = proxy?.config?.port || 25565;
                    for (const mapping of Object.values(network.dns.forcedHosts || {})) {
                        changes.push({ action: 'DELETE', name: mapping.fqdn, type: 'A', value: network.dns.serverIp, ttl: 300 });
                        changes.push({ action: 'DELETE', name: `_minecraft._tcp.${mapping.fqdn}`, type: 'SRV', value: `0 5 ${proxyPort} ${mapping.fqdn}.`, ttl: 300 });
                    }
                    if (changes.length > 0) {
                        try {
                            await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, changes);
                        } catch (e) {
                            logger.warn(`Failed to delete Route53 records: ${e.message}`);
                        }
                    }
                }
            } catch (e) {
                logger.warn(`Error cleaning up DNS records: ${e.message}`);
            }
        }

        delete network.dns;
        network.updatedAt = new Date().toISOString();

        // Re-sync proxy config to clear forced hosts
        await this.networkManager.syncProxyConfig(networkId);
        await this.networkManager.saveRegistry();

        this.emit('dns-removed', { networkId });
        logger.info(`DNS removed for network ${network.name}`);
    }

    async syncNetworkDns(networkId) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network?.dns) return;

        const provider = this.providers.get(network.dns.providerId);
        if (!provider) {
            logger.warn(`DNS sync skipped: provider ${network.dns.providerId} not found`);
            return;
        }

        try {
            const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
            const proxy = this.networkManager.serverManager.getServer(network.proxyId);
            const proxyPort = proxy?.config?.port || 25565;
            const { baseDomain, serverIp } = network.dns;

            // Ensure base A + SRV records exist
            if (provider.type === 'cloudflare') {
                // Check if base records still exist, recreate if missing
                const existingRecords = await dnsProviders.cloudflare.listRecords(creds.apiToken, creds.zoneId, { name: baseDomain });
                const hasA = existingRecords.some(r => r.type === 'A' && r.name === baseDomain);
                const srvName = `_minecraft._tcp.${baseDomain}`;
                const hasSRV = existingRecords.some(r => r.type === 'SRV');

                const newRecords = [...(network.dns.records || [])];

                if (!hasA) {
                    const aResult = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                        type: 'A', name: baseDomain, content: serverIp, proxied: false
                    });
                    // Update or add record tracking
                    const existing = newRecords.find(r => r.type === 'A' && r.name === baseDomain);
                    if (existing) { existing.providerRecordId = aResult.id; }
                    else { newRecords.push({ id: require('uuid').v4().slice(0, 8), type: 'A', name: baseDomain, value: serverIp, providerRecordId: aResult.id, managed: true }); }
                    logger.info(`DNS sync: recreated A record for ${baseDomain}`);
                }

                if (!hasSRV) {
                    const srvResult = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                        type: 'SRV', name: srvName,
                        data: { service: '_minecraft', proto: '_tcp', name: baseDomain, priority: 0, weight: 5, port: proxyPort, target: baseDomain }
                    });
                    const existing = newRecords.find(r => r.type === 'SRV' && r.name === srvName);
                    if (existing) { existing.providerRecordId = srvResult.id; }
                    else { newRecords.push({ id: require('uuid').v4().slice(0, 8), type: 'SRV', name: srvName, value: `0 5 ${proxyPort} ${baseDomain}`, providerRecordId: srvResult.id, managed: true }); }
                    logger.info(`DNS sync: recreated SRV record for ${srvName}`);
                }

                network.dns.records = newRecords;
            } else if (provider.type === 'route53') {
                // Route53: UPSERT is idempotent — always safe to re-create
                await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                    { action: 'UPSERT', name: baseDomain, type: 'A', value: serverIp, ttl: 300 },
                    { action: 'UPSERT', name: `_minecraft._tcp.${baseDomain}`, type: 'SRV', value: `0 5 ${proxyPort} ${baseDomain}.`, ttl: 300 }
                ]);

                // Also re-sync forced host records
                for (const [serverId, mapping] of Object.entries(network.dns.forcedHosts || {})) {
                    await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                        { action: 'UPSERT', name: mapping.fqdn, type: 'A', value: serverIp, ttl: 300 },
                        { action: 'UPSERT', name: `_minecraft._tcp.${mapping.fqdn}`, type: 'SRV', value: `0 5 ${proxyPort} ${mapping.fqdn}.`, ttl: 300 }
                    ]);
                }
            }

            // Re-sync proxy config (updates forced-hosts in velocity.toml / config.yml)
            await this.networkManager.syncProxyConfig(networkId);
            await this.networkManager.saveRegistry();

            this.emit('dns-sync-complete', { networkId });
            logger.info(`DNS synced for network ${network.name}`);
        } catch (e) {
            this.emit('dns-sync-error', { networkId, error: e.message });
            logger.error(`DNS sync failed for ${network.name}: ${e.message}`);
        }
    }

    async addForcedHost(networkId, serverId, subdomain) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network?.dns) throw new Error('Network DNS not configured');

        const alias = (network.backendAliases || {})[serverId];
        if (!alias) throw new Error('Server not found in network');

        const fqdn = `${subdomain}.${network.dns.baseDomain}`;
        const provider = this.providers.get(network.dns.providerId);
        if (!provider) throw new Error('DNS provider not found');

        const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
        let aRecordId = null;
        let srvRecordId = null;

        const proxy = this.networkManager.serverManager.getServer(network.proxyId);
        const proxyPort = proxy?.config?.port || 25565;

        try {
            if (provider.type === 'cloudflare') {
                const aResult = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                    type: 'A', name: fqdn, content: network.dns.serverIp, proxied: false
                });
                aRecordId = aResult.id;

                const srvResult = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                    type: 'SRV', name: `_minecraft._tcp.${fqdn}`,
                    data: { service: '_minecraft', proto: '_tcp', name: fqdn, priority: 0, weight: 5, port: proxyPort, target: fqdn }
                });
                srvRecordId = srvResult.id;
            } else if (provider.type === 'route53') {
                await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                    { action: 'UPSERT', name: fqdn, type: 'A', value: network.dns.serverIp, ttl: 300 },
                    { action: 'UPSERT', name: `_minecraft._tcp.${fqdn}`, type: 'SRV', value: `0 5 ${proxyPort} ${fqdn}.`, ttl: 300 }
                ]);
            }
        } catch (e) {
            throw new Error(`Failed to create forced host DNS records: ${e.message}`);
        }

        network.dns.forcedHosts[serverId] = {
            subdomain,
            fqdn,
            aRecordId,
            srvRecordId
        };
        network.updatedAt = new Date().toISOString();

        // Re-sync proxy config with updated forced hosts
        await this.networkManager.syncProxyConfig(networkId);
        await this.networkManager.saveRegistry();

        this.emit('forced-host-added', { networkId, serverId, fqdn });
        logger.info(`Added forced host ${fqdn} -> ${alias} in network ${network.name}`);
        return network.dns;
    }

    async removeForcedHost(networkId, serverId) {
        const network = this.networkManager.getNetwork(networkId);
        if (!network?.dns?.forcedHosts?.[serverId]) throw new Error('Forced host not found');

        const mapping = network.dns.forcedHosts[serverId];
        const provider = this.providers.get(network.dns.providerId);

        if (provider) {
            const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
            const proxy = this.networkManager.serverManager.getServer(network.proxyId);
            const proxyPort = proxy?.config?.port || 25565;

            try {
                if (provider.type === 'cloudflare') {
                    if (mapping.aRecordId) {
                        try { await dnsProviders.cloudflare.deleteRecord(creds.apiToken, creds.zoneId, mapping.aRecordId); } catch (e) {}
                    }
                    if (mapping.srvRecordId) {
                        try { await dnsProviders.cloudflare.deleteRecord(creds.apiToken, creds.zoneId, mapping.srvRecordId); } catch (e) {}
                    }
                } else if (provider.type === 'route53') {
                    await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                        { action: 'DELETE', name: mapping.fqdn, type: 'A', value: network.dns.serverIp, ttl: 300 },
                        { action: 'DELETE', name: `_minecraft._tcp.${mapping.fqdn}`, type: 'SRV', value: `0 5 ${proxyPort} ${mapping.fqdn}.`, ttl: 300 }
                    ]);
                }
            } catch (e) {
                logger.warn(`Failed to delete forced host DNS records: ${e.message}`);
            }
        }

        delete network.dns.forcedHosts[serverId];
        network.updatedAt = new Date().toISOString();

        await this.networkManager.syncProxyConfig(networkId);
        await this.networkManager.saveRegistry();

        this.emit('forced-host-removed', { networkId, serverId, fqdn: mapping.fqdn });
        logger.info(`Removed forced host ${mapping.fqdn} from network ${network.name}`);
    }

    // --- Per-Server DNS Configuration (standalone, non-network servers) ---

    _getServerOrThrow(serverId) {
        const serverManager = this.networkManager.serverManager;
        if (!serverManager) throw new Error('Server manager unavailable');
        const instance = serverManager.getServer(serverId);
        if (!instance) throw new Error('Server not found');
        return { instance, serverManager };
    }

    async configureServerDns(serverId, { providerId, domain, serverIp, autoSync }) {
        const { instance, serverManager } = this._getServerOrThrow(serverId);

        if (instance.config.dns?.providerId) {
            throw new Error('DNS already configured for this server. Remove it first.');
        }

        const provider = this.providers.get(providerId);
        if (!provider) throw new Error('DNS provider not found');

        const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
        const serverPort = instance.config.port || 25565;
        const records = [];

        try {
            if (provider.type === 'cloudflare') {
                const aRecord = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                    type: 'A', name: domain, content: serverIp, proxied: false
                });
                records.push({
                    id: uuidv4().slice(0, 8),
                    type: 'A', name: domain, value: serverIp,
                    providerRecordId: aRecord.id, managed: true
                });

                const srvRecord = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                    type: 'SRV', name: `_minecraft._tcp.${domain}`,
                    data: {
                        service: '_minecraft', proto: '_tcp', name: domain,
                        priority: 0, weight: 5, port: serverPort, target: domain
                    }
                });
                records.push({
                    id: uuidv4().slice(0, 8),
                    type: 'SRV', name: `_minecraft._tcp.${domain}`,
                    value: `0 5 ${serverPort} ${domain}`,
                    providerRecordId: srvRecord.id, managed: true
                });
            } else if (provider.type === 'route53') {
                await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                    { action: 'UPSERT', name: domain, type: 'A', value: serverIp, ttl: 300 },
                    { action: 'UPSERT', name: `_minecraft._tcp.${domain}`, type: 'SRV', value: `0 5 ${serverPort} ${domain}.`, ttl: 300 }
                ]);
                records.push(
                    { id: uuidv4().slice(0, 8), type: 'A', name: domain, value: serverIp, providerRecordId: null, managed: true },
                    { id: uuidv4().slice(0, 8), type: 'SRV', name: `_minecraft._tcp.${domain}`, value: `0 5 ${serverPort} ${domain}`, providerRecordId: null, managed: true }
                );
            } else {
                throw new Error(`Unknown provider type: ${provider.type}`);
            }
        } catch (e) {
            throw new Error(`Failed to create DNS records: ${e.message}`);
        }

        instance.config.dns = {
            providerId,
            providerName: provider.name,
            providerType: provider.type,
            domain,
            serverIp,
            port: serverPort,
            autoSync: autoSync !== false,
            records,
            createdAt: new Date().toISOString()
        };

        await serverManager.saveRegistry();
        this.emit('server-dns-configured', { serverId, domain });
        logger.info(`DNS configured for server ${instance.name}: ${domain}`);
        return instance.config.dns;
    }

    async removeServerDns(serverId) {
        const { instance, serverManager } = this._getServerOrThrow(serverId);
        if (!instance.config.dns) throw new Error('Server DNS not configured');

        const dns = instance.config.dns;
        const provider = this.providers.get(dns.providerId);

        if (provider) {
            const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
            try {
                if (provider.type === 'cloudflare') {
                    for (const record of (dns.records || [])) {
                        if (record.providerRecordId) {
                            try {
                                await dnsProviders.cloudflare.deleteRecord(creds.apiToken, creds.zoneId, record.providerRecordId);
                            } catch (e) {
                                logger.warn(`Failed to delete DNS record ${record.name}: ${e.message}`);
                            }
                        }
                    }
                } else if (provider.type === 'route53') {
                    const changes = (dns.records || []).map(r => ({
                        action: 'DELETE', name: r.name, type: r.type, value: r.value, ttl: 300
                    }));
                    if (changes.length > 0) {
                        try {
                            await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, changes);
                        } catch (e) {
                            logger.warn(`Failed to delete Route53 records: ${e.message}`);
                        }
                    }
                }
            } catch (e) {
                logger.warn(`Error cleaning up server DNS records: ${e.message}`);
            }
        }

        delete instance.config.dns;
        await serverManager.saveRegistry();
        this.emit('server-dns-removed', { serverId });
        logger.info(`DNS removed for server ${instance.name}`);
    }

    async syncServerDns(serverId) {
        const { instance, serverManager } = this._getServerOrThrow(serverId);
        const dns = instance.config.dns;
        if (!dns) throw new Error('Server DNS not configured');

        const provider = this.providers.get(dns.providerId);
        if (!provider) throw new Error('DNS provider not found');

        const creds = this._decryptCredentials(provider.credentials, provider.credentialsIv);
        const serverPort = instance.config.port || dns.port || 25565;
        const { domain, serverIp } = dns;
        const srvName = `_minecraft._tcp.${domain}`;

        try {
            if (provider.type === 'cloudflare') {
                const existing = await dnsProviders.cloudflare.listRecords(creds.apiToken, creds.zoneId, { name: domain });
                const hasA = existing.some(r => r.type === 'A' && r.name === domain);
                const hasSRV = existing.some(r => r.type === 'SRV');

                const newRecords = [...(dns.records || [])];

                if (!hasA) {
                    const aResult = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                        type: 'A', name: domain, content: serverIp, proxied: false
                    });
                    const found = newRecords.find(r => r.type === 'A' && r.name === domain);
                    if (found) found.providerRecordId = aResult.id;
                    else newRecords.push({ id: uuidv4().slice(0, 8), type: 'A', name: domain, value: serverIp, providerRecordId: aResult.id, managed: true });
                    logger.info(`DNS sync: recreated A record for ${domain}`);
                }

                if (!hasSRV) {
                    const srvResult = await dnsProviders.cloudflare.createRecord(creds.apiToken, creds.zoneId, {
                        type: 'SRV', name: srvName,
                        data: { service: '_minecraft', proto: '_tcp', name: domain, priority: 0, weight: 5, port: serverPort, target: domain }
                    });
                    const found = newRecords.find(r => r.type === 'SRV' && r.name === srvName);
                    if (found) found.providerRecordId = srvResult.id;
                    else newRecords.push({ id: uuidv4().slice(0, 8), type: 'SRV', name: srvName, value: `0 5 ${serverPort} ${domain}`, providerRecordId: srvResult.id, managed: true });
                    logger.info(`DNS sync: recreated SRV record for ${srvName}`);
                }

                dns.records = newRecords;
            } else if (provider.type === 'route53') {
                // UPSERT is idempotent — always safe to re-create
                await dnsProviders.route53.changeRecordSets(creds.accessKeyId, creds.secretAccessKey, creds.hostedZoneId, [
                    { action: 'UPSERT', name: domain, type: 'A', value: serverIp, ttl: 300 },
                    { action: 'UPSERT', name: srvName, type: 'SRV', value: `0 5 ${serverPort} ${domain}.`, ttl: 300 }
                ]);
            }

            // Track current port in case it changed
            dns.port = serverPort;
            await serverManager.saveRegistry();

            this.emit('server-dns-sync-complete', { serverId });
            logger.info(`DNS synced for server ${instance.name}`);
            return dns;
        } catch (e) {
            this.emit('server-dns-sync-error', { serverId, error: e.message });
            logger.error(`DNS sync failed for ${instance.name}: ${e.message}`);
            throw e;
        }
    }
}

module.exports = DnsManager;
