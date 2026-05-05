// FortunaPanel - Revoked Token Store
// Tracks JWT ids (jti) that have been revoked (e.g. via logout) so the
// middleware can reject them before they expire naturally.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/default');
const logger = require('../utils/logger');

const STORE_PATH = path.join(config.dataDir, 'revoked-tokens.json');
// Cap total entries so a misbehaving client can't grow the store forever.
// At panel scale, 10k revoked tokens is vastly more than a human will ever
// produce; the prune loop keeps us well under this in practice.
const MAX_ENTRIES = 10_000;

class RevokedTokenStore {
    constructor() {
        this.revoked = new Map(); // jti -> expiresAtMs
        this._load();
        // Prune expired entries every 10 min. Unref so we don't hold the
        // event loop open during shutdown.
        this._pruneTimer = setInterval(() => this._prune(), 10 * 60 * 1000);
        if (this._pruneTimer.unref) this._pruneTimer.unref();
    }

    _load() {
        try {
            if (!fs.existsSync(STORE_PATH)) return;
            const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            if (data && typeof data === 'object') {
                const now = Date.now();
                for (const [jti, expMs] of Object.entries(data)) {
                    if (typeof expMs === 'number' && expMs > now) {
                        this.revoked.set(jti, expMs);
                    }
                }
            }
        } catch (e) {
            logger.error(`Failed to load revoked tokens: ${e.message}`);
        }
    }

    _save() {
        const tmpPath = STORE_PATH + '.tmp';
        try {
            const obj = Object.fromEntries(this.revoked);
            const fd = fs.openSync(tmpPath, 'w');
            try {
                fs.writeFileSync(fd, JSON.stringify(obj));
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(tmpPath, STORE_PATH);
        } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            logger.error(`Failed to save revoked tokens: ${e.message}`);
        }
    }

    _prune() {
        const now = Date.now();
        let removed = 0;
        for (const [jti, expMs] of this.revoked) {
            if (expMs <= now) {
                this.revoked.delete(jti);
                removed++;
            }
        }
        if (removed > 0) this._save();
    }

    // Revoke a token by its jti. expSeconds is the JWT exp claim (unix seconds).
    revoke(jti, expSeconds) {
        if (typeof jti !== 'string' || !jti) return;
        const expMs = typeof expSeconds === 'number' ? expSeconds * 1000 : Date.now() + 60_000;
        // Already-expired tokens don't need tracking.
        if (expMs <= Date.now()) return;

        if (this.revoked.size >= MAX_ENTRIES) {
            this._prune();
            if (this.revoked.size >= MAX_ENTRIES) {
                // Still full: drop oldest (Map preserves insertion order).
                const firstKey = this.revoked.keys().next().value;
                if (firstKey !== undefined) this.revoked.delete(firstKey);
            }
        }

        this.revoked.set(jti, expMs);
        this._save();
    }

    isRevoked(jti) {
        if (typeof jti !== 'string' || !jti) return false;
        const expMs = this.revoked.get(jti);
        if (!expMs) return false;
        if (expMs <= Date.now()) {
            this.revoked.delete(jti);
            return false;
        }
        return true;
    }

    stop() {
        if (this._pruneTimer) clearInterval(this._pruneTimer);
    }

    // Generate a fresh jti. Used by the auth routes when signing tokens so
    // every issued token has a stable id we can revoke later.
    static newJti() {
        return crypto.randomBytes(16).toString('hex');
    }
}

module.exports = RevokedTokenStore;
