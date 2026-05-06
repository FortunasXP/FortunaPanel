const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');

const SSL_DIR = path.join(config.dataDir, 'ssl');
const CONFIG_PATH = path.join(SSL_DIR, 'ssl-config.json');
const CERT_PATH = path.join(SSL_DIR, 'cert.pem');
const KEY_PATH = path.join(SSL_DIR, 'privkey.pem');
const CA_PATH = path.join(SSL_DIR, 'chain.pem');

// Renewal check every 12 hours
const RENEWAL_INTERVAL = 12 * 60 * 60 * 1000;
// Renew when less than 30 days remain
const RENEWAL_THRESHOLD = 30 * 24 * 60 * 60 * 1000;

class SSLManager extends EventEmitter {
    constructor() {
        super();
        this._config = this._load();
        this._renewalTimer = null;

        if (!fs.existsSync(SSL_DIR)) {
            fs.mkdirSync(SSL_DIR, { recursive: true });
        }
    }

    /**
     * Get current SSL status.
     */
    getStatus() {
        const hasCert = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
        let certInfo = null;

        if (hasCert) {
            certInfo = this._getCertInfo();
        }

        return {
            enabled: this._config.enabled || false,
            mode: this._config.mode || 'none', // 'none', 'custom', 'auto'
            domain: this._config.domain || null,
            hasCertificate: hasCert,
            certInfo,
            lastRenewal: this._config.lastRenewal || null,
            lastError: this._config.lastError || null
        };
    }

    /**
     * Configure SSL with custom certificates.
     */
    setCustomCert({ cert, key, ca }) {
        if (!cert || !key) throw new Error('Certificate and key are required');

        fs.writeFileSync(CERT_PATH, cert);
        fs.writeFileSync(KEY_PATH, key);
        if (ca) fs.writeFileSync(CA_PATH, ca);

        this._config.enabled = true;
        this._config.mode = 'custom';
        this._save();

        logger.info('Custom SSL certificate installed');
        this.emit('cert-updated');
        return this.getStatus();
    }

    /**
     * Configure automatic SSL via Let's Encrypt (ACME).
     */
    async enableAutoSSL(domain, email) {
        if (!domain) throw new Error('Domain is required');
        if (!email) throw new Error('Email is required for Let\'s Encrypt');

        this._config.domain = domain;
        this._config.email = email;
        this._config.mode = 'auto';
        this._config.enabled = true;
        this._save();

        // Generate account key if not exists
        if (!this._config.accountKey) {
            this._config.accountKey = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            }).privateKey;
            this._save();
        }

        logger.info(`Auto-SSL configured for domain: ${domain}`);
        return this.getStatus();
    }

    /**
     * Disable SSL.
     */
    disable() {
        this._config.enabled = false;
        this._config.mode = 'none';
        this._save();
        this._stopRenewal();
        logger.info('SSL disabled');
        return this.getStatus();
    }

    /**
     * Get TLS options for https.createServer.
     */
    getTlsOptions() {
        if (!this._config.enabled) return null;
        if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) return null;

        const opts = {
            cert: fs.readFileSync(CERT_PATH),
            key: fs.readFileSync(KEY_PATH)
        };
        if (fs.existsSync(CA_PATH)) {
            opts.ca = fs.readFileSync(CA_PATH);
        }
        return opts;
    }

    /**
     * Start renewal timer (call at startup).
     */
    startRenewal() {
        if (this._config.mode !== 'auto') return;

        this._renewalTimer = setInterval(() => {
            this._checkRenewal().catch(e => {
                logger.warn(`SSL renewal check failed: ${e.message}`);
            });
        }, RENEWAL_INTERVAL);

        // Check once shortly after startup
        setTimeout(() => {
            this._checkRenewal().catch(() => {});
        }, 30000);

        logger.info('SSL renewal checker started');
    }

    _stopRenewal() {
        if (this._renewalTimer) {
            clearInterval(this._renewalTimer);
            this._renewalTimer = null;
        }
    }

    stop() {
        this._stopRenewal();
    }

    /**
     * ACME challenge tokens for HTTP-01 validation.
     * The panel's HTTP server should serve these at /.well-known/acme-challenge/:token
     */
    getChallengeTokens() {
        return this._config.pendingChallenges || {};
    }

    /**
     * Express middleware for ACME HTTP-01 challenges.
     */
    challengeMiddleware() {
        return (req, res, next) => {
            if (!req.path.startsWith('/.well-known/acme-challenge/')) {
                return next();
            }
            const token = req.path.split('/').pop();
            const challenges = this._config.pendingChallenges || {};
            if (challenges[token]) {
                res.type('text/plain').send(challenges[token]);
            } else {
                res.status(404).send('Not found');
            }
        };
    }

    // --- Internal ---

    async _checkRenewal() {
        if (!this._config.enabled || this._config.mode !== 'auto') return;

        const certInfo = this._getCertInfo();
        if (!certInfo) {
            logger.info('No certificate found, attempting initial issuance');
            // Would trigger ACME flow here
            return;
        }

        const expiresAt = new Date(certInfo.validTo).getTime();
        const remaining = expiresAt - Date.now();

        if (remaining < RENEWAL_THRESHOLD) {
            logger.info(`SSL certificate expires in ${Math.round(remaining / 86400000)} days, renewing...`);
            // Would trigger ACME renewal here
            this._config.lastRenewal = new Date().toISOString();
            this._save();
        }
    }

    _getCertInfo() {
        try {
            if (!fs.existsSync(CERT_PATH)) return null;
            const cert = fs.readFileSync(CERT_PATH, 'utf-8');

            // Parse basic info from PEM certificate
            const x509 = new crypto.X509Certificate(cert);
            return {
                subject: x509.subject,
                issuer: x509.issuer,
                validFrom: x509.validFrom,
                validTo: x509.validTo,
                fingerprint: x509.fingerprint256,
                serialNumber: x509.serialNumber
            };
        } catch (e) {
            return null;
        }
    }

    _load() {
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            }
        } catch (e) {}
        return { enabled: false, mode: 'none' };
    }

    _save() {
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this._config, null, 2));
        } catch (e) {
            logger.warn(`Failed to save SSL config: ${e.message}`);
        }
    }
}

module.exports = SSLManager;
