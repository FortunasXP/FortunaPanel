const fs = require('fs');
const path = require('path');
const config = require('../config/default');
const logger = require('../utils/logger');
const { getSqliteStore } = require('../db/sqlite');

const LOG_PATH = path.join(config.dataDir, 'activity.json');
const MAX_ENTRIES = 500;
// Cap serialized details so a malicious plugin / misbehaving caller can't
// push multi-megabyte objects into the activity log and starve disk.
const MAX_DETAILS_BYTES = 32 * 1024;

class ActivityLog {
    constructor() {
        this.entries = [];
        this.store = getSqliteStore();
        this._load();
    }

    _load() {
        if (this.store.enabled) {
            this.entries = this.store.listActivity();
            return;
        }
        try {
            if (fs.existsSync(LOG_PATH)) {
                this.entries = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
            }
        } catch (e) {
            logger.error(`Failed to load activity log: ${e.message}`);
            this.entries = [];
        }
    }

    _save() {
        if (this.store.enabled) {
            for (const entry of this.entries) {
                this.store.insertActivity(entry);
            }
            this.store.trimActivity(MAX_ENTRIES);
            return;
        }
        // Atomic write: tmp + fsync + rename. Avoids a crash mid-write
        // leaving activity.json truncated.
        const tmpPath = LOG_PATH + '.tmp';
        try {
            const fd = fs.openSync(tmpPath, 'w');
            try {
                fs.writeFileSync(fd, JSON.stringify(this.entries, null, 2));
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(tmpPath, LOG_PATH);
        } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            logger.error(`Failed to save activity log: ${e.message}`);
        }
    }

    // Clamp details size — stringify, truncate if too large.
    _clampDetails(details) {
        if (details == null) return {};
        try {
            const json = JSON.stringify(details);
            if (json.length <= MAX_DETAILS_BYTES) return details;
            return { truncated: true, summary: json.slice(0, MAX_DETAILS_BYTES) + '...' };
        } catch (e) {
            return { error: 'details not serializable' };
        }
    }

    /**
     * Log an activity event
     * @param {string} action - Action type: server.start, server.stop, server.create, server.delete,
     *                          player.join, player.leave, player.kick, player.ban,
     *                          config.change, backup.create, backup.restore, auth.login, etc.
     * @param {object} details - Event details
     * @param {string} [user] - Username performing the action
     */
    log(action, details = {}, user = 'system', diff = null) {
        // Basic input shape: action must be a non-empty string, others get
        // coerced. Never let a caller crash the logger.
        const safeAction = typeof action === 'string' && action ? action.slice(0, 120) : 'unknown';
        const safeUser = typeof user === 'string' && user ? user.slice(0, 120) : 'system';

        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            action: safeAction,
            details: this._clampDetails(details),
            user: safeUser,
            timestamp: new Date().toISOString()
        };

        if (diff) {
            entry.diff = this._clampDetails(diff);
        }

        this.entries.unshift(entry);

        // Trim to max entries
        if (this.entries.length > MAX_ENTRIES) {
            this.entries = this.entries.slice(0, MAX_ENTRIES);
        }

        try {
            if (this.store.enabled) {
                this.store.insertActivity(entry);
                this.store.trimActivity(MAX_ENTRIES);
            } else {
                this._save();
            }
        } catch (e) {
            logger.error(`ActivityLog persistence failed for ${safeAction}: ${e.message}`);
        }
        return entry;
    }

    /**
     * Get activity entries with optional filtering
     * @param {object} options - Filter options
     * @param {number} [options.limit=50] - Max entries to return
     * @param {number} [options.offset=0] - Offset for pagination
     * @param {string} [options.action] - Filter by action prefix (e.g., 'server' matches server.*)
     * @param {string} [options.serverId] - Filter by server ID
     */
    getEntries(options = {}) {
        let filtered = this.entries;

        if (options.action) {
            filtered = filtered.filter(e => e.action.startsWith(options.action));
        }

        if (options.serverId) {
            filtered = filtered.filter(e => e.details.serverId === options.serverId);
        }

        const offset = options.offset || 0;
        const limit = options.limit || 50;

        return {
            entries: filtered.slice(offset, offset + limit),
            total: filtered.length
        };
    }

    clear() {
        this.entries = [];
        if (this.store.enabled) {
            this.store.clearActivity();
        } else {
            this._save();
        }
    }
}

module.exports = ActivityLog;
