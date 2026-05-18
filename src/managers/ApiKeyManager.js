// FortunaPanel - API Key Manager
// Manages application-level and client-level API keys
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/default');
const logger = require('../utils/logger');

const KEYS_PATH = path.join(config.dataDir, 'api-keys.json');

class ApiKeyManager {
    constructor() {
        this.keys = [];
        this._saveTimer = null;
        this._dirty = false;
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(KEYS_PATH)) {
                this.keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8'));
            }
        } catch (e) {
            logger.error(`Failed to load API keys: ${e.message}`);
            this.keys = [];
        }
    }

    // Atomic write: serialize to temp file, fsync, then rename into place so a
    // crash mid-write can't leave a corrupt api-keys.json.
    save() {
        const tmp = `${KEYS_PATH}.${process.pid}.tmp`;
        const payload = JSON.stringify(this.keys, null, 2);
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeSync(fd, payload);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, KEYS_PATH);
        this._dirty = false;
    }

    // Debounced save: coalesces rapid writes (e.g. usage counter bumps) into
    // one disk write per second. Preserves latest state if the process exits
    // gracefully via flush(); still safer than "save every 100 uses".
    _saveSoon() {
        this._dirty = true;
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            if (!this._dirty) return;
            try { this.save(); }
            catch (e) { logger.error(`API key save failed: ${e.message}`); }
        }, 1000);
        // Don't hold the process open just for this timer.
        if (this._saveTimer.unref) this._saveTimer.unref();
    }

    // Call on graceful shutdown to flush pending writes.
    flush() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (this._dirty) {
            try { this.save(); }
            catch (e) { logger.error(`API key flush failed: ${e.message}`); }
        }
    }

    // Generate a new API key
    createKey(options = {}) {
        const {
            description = 'API Key',
            type = 'client',           // 'application' (admin-level) or 'client' (user-level)
            username = 'admin',
            permissions = [],           // specific permissions for client keys
            allowedServers = [],        // empty = all servers
            allowedIPs = [],            // IP whitelist, empty = all
        } = options;

        const key = `fp_${type === 'application' ? 'app' : 'cli'}_${crypto.randomBytes(32).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(key).digest('hex');

        const entry = {
            id: crypto.randomUUID(),
            keyHash,
            keyPrefix: key.slice(0, 16) + '...',
            description,
            type,
            username,
            permissions,
            allowedServers,
            allowedIPs,
            createdAt: new Date().toISOString(),
            lastUsed: null,
            usageCount: 0,
            enabled: true
        };

        this.keys.push(entry);
        this.save();
        logger.info(`API key created: ${entry.keyPrefix} (${type}) for ${username}`);

        // Return the full key only once at creation time
        return { ...entry, key };
    }

    // Validate an API key and return the key entry
    validateKey(rawKey) {
        if (!rawKey) return null;

        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const entry = this.keys.find(k => k.keyHash === keyHash && k.enabled);

        if (entry) {
            entry.lastUsed = new Date().toISOString();
            entry.usageCount++;
            this._saveSoon();
            return entry;
        }

        return null;
    }

    // Check if a key has permission for a specific action
    hasPermission(keyEntry, permission, serverId = null) {
        if (!keyEntry || !keyEntry.enabled) return false;

        // Application keys have full access
        if (keyEntry.type === 'application') return true;

        // Check server access
        if (serverId && keyEntry.allowedServers && keyEntry.allowedServers.length > 0) {
            if (!keyEntry.allowedServers.includes(serverId)) return false;
        }

        // Client keys need an EXPLICIT permission match. Empty permissions
        // means "no permissions" (deny-by-default), not "all permissions".
        // The previous behavior allowed privilege escalation: a user could
        // create a client key with permissions=[] and bypass every check.
        if (!Array.isArray(keyEntry.permissions) || keyEntry.permissions.length === 0) {
            return false;
        }
        if (keyEntry.permissions.includes('*')) return true;
        return keyEntry.permissions.includes(permission);
    }

    // List all keys (without sensitive data)
    listKeys() {
        return this.keys.map(k => ({
            id: k.id,
            keyPrefix: k.keyPrefix,
            description: k.description,
            type: k.type,
            username: k.username,
            permissions: k.permissions,
            allowedServers: k.allowedServers,
            allowedIPs: k.allowedIPs,
            createdAt: k.createdAt,
            lastUsed: k.lastUsed,
            usageCount: k.usageCount,
            enabled: k.enabled
        }));
    }

    // List keys for one user (or all keys for admins)
    listKeysForUser(username, isAdmin = false) {
        const keys = isAdmin ? this.keys : this.keys.filter(k => k.username === username);
        return keys.map(k => ({
            id: k.id,
            keyPrefix: k.keyPrefix,
            description: k.description,
            type: k.type,
            username: k.username,
            permissions: k.permissions,
            allowedServers: k.allowedServers,
            allowedIPs: k.allowedIPs,
            createdAt: k.createdAt,
            lastUsed: k.lastUsed,
            usageCount: k.usageCount,
            enabled: k.enabled
        }));
    }

    getKeyById(id) {
        return this.keys.find(k => k.id === id) || null;
    }

    // Delete an API key
    deleteKey(id) {
        const idx = this.keys.findIndex(k => k.id === id);
        if (idx === -1) return false;
        this.keys.splice(idx, 1);
        this.save();
        return true;
    }

    // Toggle key enabled/disabled
    toggleKey(id) {
        const key = this.keys.find(k => k.id === id);
        if (!key) return null;
        key.enabled = !key.enabled;
        this.save();
        return key;
    }

    // Update key permissions
    updateKey(id, updates) {
        const key = this.keys.find(k => k.id === id);
        if (!key) return null;

        if (updates.description !== undefined) key.description = updates.description;
        if (updates.permissions !== undefined) key.permissions = updates.permissions;
        if (updates.allowedServers !== undefined) key.allowedServers = updates.allowedServers;
        if (updates.allowedIPs !== undefined) key.allowedIPs = updates.allowedIPs;
        if (updates.enabled !== undefined) key.enabled = updates.enabled;

        this.save();
        return key;
    }

    // Check IP whitelist
    isIPAllowed(keyEntry, ip) {
        if (!keyEntry.allowedIPs || keyEntry.allowedIPs.length === 0) return true;
        // Normalize IPv6 localhost
        const normalizedIP = ip === '::1' || ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip;
        return keyEntry.allowedIPs.includes(normalizedIP);
    }
}

module.exports = ApiKeyManager;
