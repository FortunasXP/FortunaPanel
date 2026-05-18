// FortunaPanel - Two-Factor Authentication Manager (TOTP)
const { TOTP, Secret } = require('otpauth');
const QRCode = require('qrcode');
const crypto = require('crypto');
const logger = require('../utils/logger');
const UserStore = require('./UserStore');

// Per-user verification throttle. Limits brute-force attempts against TOTP
// codes (~1M possibilities with a 1-step window) and 8-hex-char backup codes
// (2^32 possibilities). Bounded in size to avoid unbounded memory growth.
const VERIFY_WINDOW_MS = 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_LOCKOUT_MS = 15 * 60 * 1000;
const VERIFY_BUCKETS_MAX = 10000;

class TwoFactorManager {
    constructor() {
        this.userStore = new UserStore();
        this._verifyAttempts = new Map(); // username -> { count, firstAt, lockedUntil }
    }

    _checkThrottle(username) {
        const now = Date.now();
        const entry = this._verifyAttempts.get(username);
        if (!entry) return { blocked: false };
        if (entry.lockedUntil && entry.lockedUntil > now) {
            return { blocked: true, retryAfterMs: entry.lockedUntil - now };
        }
        return { blocked: false };
    }

    _recordFailure(username) {
        const now = Date.now();
        // Evict oldest entry if we've hit the cap.
        if (this._verifyAttempts.size >= VERIFY_BUCKETS_MAX && !this._verifyAttempts.has(username)) {
            const firstKey = this._verifyAttempts.keys().next().value;
            if (firstKey !== undefined) this._verifyAttempts.delete(firstKey);
        }
        const entry = this._verifyAttempts.get(username) || { count: 0, firstAt: now, lockedUntil: 0 };
        if (now - entry.firstAt > VERIFY_WINDOW_MS) {
            entry.count = 0;
            entry.firstAt = now;
            entry.lockedUntil = 0;
        }
        entry.count += 1;
        if (entry.count >= VERIFY_MAX_ATTEMPTS) {
            entry.lockedUntil = now + VERIFY_LOCKOUT_MS;
            entry.count = 0;
            entry.firstAt = now;
            logger.warn(`2FA verification locked for ${username} after repeated failures`);
        }
        this._verifyAttempts.set(username, entry);
    }

    _clearFailures(username) {
        this._verifyAttempts.delete(username);
    }

    // Generate a new TOTP secret for a user (does NOT enable 2FA yet)
    generateSecret(username) {
        const user = this.userStore.getUser(username);
        if (!user) throw new Error('User not found');

        const secret = new Secret({ size: 20 });

        const totp = new TOTP({
            issuer: 'FortunaPanel',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret
        });

        const uri = totp.toString();

        // Store pending secret (not yet verified)
        const twoFactor = {
            ...(user.twoFactor || {}),
            pendingSecret: secret.base32,
            enabled: user.twoFactor?.enabled || false
        };

        this.userStore.updateTwoFactor(username, twoFactor);

        return {
            secret: secret.base32,
            uri,
            qrDataUrl: null // Will be generated async
        };
    }

    // Generate QR code as data URL
    async generateQRCode(username) {
        const result = this.generateSecret(username);

        try {
            result.qrDataUrl = await QRCode.toDataURL(result.uri, {
                width: 256,
                margin: 2,
                color: { dark: '#ffffff', light: '#09090b' }
            });
        } catch (e) {
            logger.error(`Failed to generate QR code: ${e.message}`);
        }

        return result;
    }

    // Verify a TOTP code and enable 2FA if it matches the pending secret
    verifyAndEnable(username, code) {
        const user = this.userStore.getUser(username);
        if (!user) throw new Error('User not found');

        const pendingSecret = user.twoFactor?.pendingSecret;
        if (!pendingSecret) throw new Error('No pending 2FA setup. Generate a secret first.');

        // Apply the same lockout/throttle policy as verifyCode so an
        // attacker can't brute-force the 6-digit code space during the
        // setup window.
        const throttle = this._checkThrottle(username);
        if (throttle.locked) {
            throw new Error(`Too many failed attempts. Try again in ${throttle.retryAfter}s`);
        }

        if (typeof code !== 'string' || !code) {
            this._recordFailure(username);
            throw new Error('Invalid verification code');
        }

        const totp = new TOTP({
            issuer: 'FortunaPanel',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: Secret.fromBase32(pendingSecret)
        });

        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) {
            this._recordFailure(username);
            throw new Error('Invalid verification code');
        }
        this._clearFailures(username);

        // Generate backup codes
        const backupCodes = Array.from({ length: 8 }, () =>
            crypto.randomBytes(4).toString('hex')
        );
        const backupCodeHashes = backupCodes.map(c =>
            crypto.createHash('sha256').update(c).digest('hex')
        );

        // Enable 2FA
        const twoFactor = {
            enabled: true,
            secret: pendingSecret,
            pendingSecret: undefined,
            enabledAt: new Date().toISOString(),
            backupCodes: backupCodeHashes
        };

        this.userStore.updateTwoFactor(username, twoFactor);
        logger.info(`2FA enabled for user: ${username}`);

        return { enabled: true, backupCodes };
    }

    // Verify a TOTP code for login
    verifyCode(username, code) {
        const user = this.userStore.getUser(username);
        if (!user) return false;

        if (!user.twoFactor?.enabled || !user.twoFactor?.secret) {
            return true; // 2FA not enabled, skip
        }

        if (typeof code !== 'string' || !code) {
            this._recordFailure(username);
            return false;
        }

        const throttle = this._checkThrottle(username);
        if (throttle.blocked) {
            logger.warn(`2FA verification blocked for ${username} (locked for ${Math.ceil(throttle.retryAfterMs / 1000)}s)`);
            return false;
        }

        // Check if it's a backup code
        if (code.length === 8 && /^[a-f0-9]+$/.test(code)) {
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            const backupCodes = [...(user.twoFactor.backupCodes || [])];
            const idx = backupCodes.indexOf(codeHash);
            if (idx !== -1) {
                // Consume the backup code
                backupCodes.splice(idx, 1);
                this.userStore.updateTwoFactor(username, {
                    ...user.twoFactor,
                    backupCodes
                });
                this._clearFailures(username);
                logger.info(`Backup code used by ${username}. ${backupCodes.length} remaining.`);
                return true;
            }
        }

        const totp = new TOTP({
            issuer: 'FortunaPanel',
            label: username,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: Secret.fromBase32(user.twoFactor.secret)
        });

        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) {
            this._recordFailure(username);
            return false;
        }
        this._clearFailures(username);
        return true;
    }

    // Check if user has 2FA enabled
    isEnabled(username) {
        const user = this.userStore.getUser(username);
        if (!user) return false;
        return user.twoFactor?.enabled || false;
    }

    // Disable 2FA for a user
    disable(username, code) {
        const user = this.userStore.getUser(username);
        if (!user) throw new Error('User not found');

        if (!user.twoFactor?.enabled) {
            throw new Error('2FA is not enabled');
        }

        // Verify current code before disabling
        if (!this.verifyCode(username, code)) {
            throw new Error('Invalid verification code');
        }

        this.userStore.updateTwoFactor(username, { enabled: false });
        logger.info(`2FA disabled for user: ${username}`);

        return { disabled: true };
    }
}

module.exports = TwoFactorManager;
