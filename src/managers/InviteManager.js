const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/default');
const logger = require('../utils/logger');

const STORE_PATH = path.join(config.dataDir, 'invites.json');
const DEFAULT_EXPIRY_HOURS = 48;
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Hourly

class InviteManager {
    constructor() {
        this._data = this._load();
        this._cleanupTimer = null;
    }

    start() {
        this._cleanup();
        this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL);
        logger.info('Invite manager started');
    }

    stop() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    // --- Invite Links ---

    createInvite(role = 'viewer', createdBy = 'admin', expiryHours = DEFAULT_EXPIRY_HOURS) {
        const code = crypto.randomBytes(24).toString('base64url');
        const invite = {
            code,
            type: 'invite',
            role,
            createdBy,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
            used: false
        };

        this._data.tokens.push(invite);
        this._save();
        logger.info(`Invite created by ${createdBy} (role: ${role}, expires: ${expiryHours}h)`);
        return invite;
    }

    redeemInvite(code) {
        const invite = this._data.tokens.find(t =>
            t.type === 'invite' && t.code === code && !t.used
        );
        if (!invite) return null;
        if (new Date(invite.expiresAt) < new Date()) return null;
        return invite;
    }

    /**
     * Atomically claim an invite — find it, mark used, and persist in one
     * synchronous step. Node is single-threaded, so as long as no `await`
     * runs between the find and the mutation, two concurrent redemption
     * requests cannot both succeed. Returns a copy of the invite for the
     * caller to use, or null if invalid/expired/already used.
     *
     * Use this in preference to redeemInvite + markInviteUsed when you
     * are claiming the invite. Use redeemInvite alone only for read-only
     * validity checks.
     */
    claimInvite(code, username) {
        const invite = this._data.tokens.find(t =>
            t.type === 'invite' && t.code === code && !t.used
        );
        if (!invite) return null;
        if (new Date(invite.expiresAt) < new Date()) return null;
        invite.used = true;
        invite.usedBy = username || null;
        invite.usedAt = new Date().toISOString();
        this._save();
        return { ...invite };
    }

    markInviteUsed(code, username) {
        const invite = this._data.tokens.find(t =>
            t.type === 'invite' && t.code === code
        );
        if (invite) {
            invite.used = true;
            invite.usedBy = username;
            invite.usedAt = new Date().toISOString();
            this._save();
        }
    }

    listInvites() {
        return this._data.tokens
            .filter(t => t.type === 'invite')
            .map(t => ({
                code: t.code,
                role: t.role,
                createdBy: t.createdBy,
                createdAt: t.createdAt,
                expiresAt: t.expiresAt,
                used: t.used,
                usedBy: t.usedBy || null,
                expired: new Date(t.expiresAt) < new Date()
            }));
    }

    deleteInvite(code) {
        const before = this._data.tokens.length;
        this._data.tokens = this._data.tokens.filter(t =>
            !(t.type === 'invite' && t.code === code)
        );
        if (this._data.tokens.length < before) {
            this._save();
            return true;
        }
        return false;
    }

    // --- Password Reset Tokens ---

    createResetToken(username, createdBy = 'admin', expiryHours = 24) {
        // Invalidate any existing reset tokens for this user
        this._data.tokens = this._data.tokens.filter(t =>
            !(t.type === 'reset' && t.username === username && !t.used)
        );

        const code = crypto.randomBytes(24).toString('base64url');
        const token = {
            code,
            type: 'reset',
            username,
            createdBy,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
            used: false
        };

        this._data.tokens.push(token);
        this._save();
        logger.info(`Password reset token created for ${username} by ${createdBy}`);
        return token;
    }

    redeemResetToken(code) {
        const token = this._data.tokens.find(t =>
            t.type === 'reset' && t.code === code && !t.used
        );
        if (!token) return null;
        if (new Date(token.expiresAt) < new Date()) return null;
        return token;
    }

    /**
     * Atomic claim for password-reset tokens. Same contract as
     * claimInvite — find + mark + save in one synchronous step.
     */
    claimResetToken(code) {
        const token = this._data.tokens.find(t =>
            t.type === 'reset' && t.code === code && !t.used
        );
        if (!token) return null;
        if (new Date(token.expiresAt) < new Date()) return null;
        token.used = true;
        token.usedAt = new Date().toISOString();
        this._save();
        return { ...token };
    }

    markResetUsed(code) {
        const token = this._data.tokens.find(t =>
            t.type === 'reset' && t.code === code
        );
        if (token) {
            token.used = true;
            token.usedAt = new Date().toISOString();
            this._save();
        }
    }

    // --- Internal ---

    _cleanup() {
        const now = new Date();
        const before = this._data.tokens.length;
        this._data.tokens = this._data.tokens.filter(t => {
            // Keep used tokens for 7 days (audit trail), then purge
            if (t.used) {
                const usedAt = new Date(t.usedAt || t.expiresAt);
                return (now - usedAt) < 7 * 24 * 60 * 60 * 1000;
            }
            // Purge expired unused tokens after 24h past expiry
            const expires = new Date(t.expiresAt);
            return (now - expires) < 24 * 60 * 60 * 1000;
        });
        if (this._data.tokens.length < before) {
            this._save();
        }
    }

    _load() {
        try {
            if (fs.existsSync(STORE_PATH)) {
                return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            }
        } catch (e) {}
        return { tokens: [] };
    }

    _save() {
        try {
            fs.writeFileSync(STORE_PATH, JSON.stringify(this._data, null, 2));
        } catch (e) {
            logger.warn(`Failed to save invites: ${e.message}`);
        }
    }
}

module.exports = InviteManager;
