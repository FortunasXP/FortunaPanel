const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const dataDir = path.resolve(process.env.DATA_DIR || './data');

// JWT secret resolution:
//   1. JWT_SECRET env var wins (CI/server deployments).
//   2. Development mode uses a fixed dev secret for convenience.
//   3. Otherwise (packaged Electron app), generate a secret on first run and
//      persist it in dataDir/.jwt-secret so subsequent launches reuse it.
//      This keeps issued JWTs valid AND keeps DnsManager's credential
//      encryption key stable (it derives from jwtSecret).
function resolveJwtSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    if (process.env.NODE_ENV === 'development') return 'dev-only-change-me';

    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const secretPath = path.join(dataDir, '.jwt-secret');
        if (fs.existsSync(secretPath)) {
            const stored = fs.readFileSync(secretPath, 'utf-8').trim();
            if (stored.length >= 32) return stored;
        }
        const generated = crypto.randomBytes(64).toString('hex');
        fs.writeFileSync(secretPath, generated, { mode: 0o600 });
        return generated;
    } catch (e) {
        throw new Error(`Could not load or generate JWT secret in ${dataDir}: ${e.message}. Set JWT_SECRET in the environment to override.`);
    }
}

// Comma-separated list of allowed Origins for WebSocket / CORS. If unset,
// same-origin requests (no Origin header, or matching the panel host) are
// accepted — typical for Electron and localhost deployments.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// Cap JWT lifetime so a misconfigured JWT_EXPIRY can't issue year-long tokens.
// Anything longer gets clamped to 7 days.
const JWT_MAX_SECONDS = 7 * 24 * 60 * 60;
function parseExpiry(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return 24 * 60 * 60;
    const m = value.trim().match(/^(\d+)\s*([smhd])?$/i);
    if (!m) return 24 * 60 * 60;
    const n = parseInt(m[1], 10);
    const unit = (m[2] || 's').toLowerCase();
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
    return n * mult;
}
const requestedExpiry = parseExpiry(process.env.JWT_EXPIRY || '24h');
const jwtExpirySeconds = Math.min(requestedExpiry, JWT_MAX_SECONDS);

module.exports = {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    jwtSecret: resolveJwtSecret(),
    jwtExpiry: `${jwtExpirySeconds}s`,
    jwtExpirySeconds,
    jwtMaxSeconds: JWT_MAX_SECONDS,
    serversRoot: path.resolve(process.env.SERVERS_ROOT || './servers'),
    dataDir,
    jarsCache: path.resolve(dataDir, 'jars'),
    defaultJavaPath: process.env.JAVA_PATH || 'java',
    maxServers: parseInt(process.env.MAX_SERVERS) || 10,
    logLevel: process.env.LOG_LEVEL || 'info',
    allowedOrigins,
    // Reverse-proxy trust setting; see src/index.js for the policy.
    // Unset = "loopback" only; "true" = trust 1 hop; otherwise pass-through.
    trustProxy: process.env.TRUST_PROXY,
};
