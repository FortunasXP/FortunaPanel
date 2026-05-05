const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../config/default');
const logger = require('../utils/logger');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const { requireString } = require('../utils/validation');
const UserStore = require('../managers/UserStore');
const RevokedTokenStore = require('../managers/RevokedTokenStore');

const router = express.Router();

// Use the shared UserStore from app.locals when available, fall back for setup routes
function getUserStore(req) {
    return req.app.locals.userStore || (req.app.locals.userStore = new UserStore());
}

// Sign a token with a random jti so it can be revoked before its exp.
function signToken(payload) {
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpiry,
        jwtid: RevokedTokenStore.newJti()
    });
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = parseInt(process.env.LOGIN_WINDOW_MS || '600000', 10);
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '10', 10);
const LOGIN_LOCKOUT_MS = parseInt(process.env.LOGIN_LOCKOUT_MS || '900000', 10);
// Upper bound on concurrent tracked buckets. Prevents an attacker from
// spamming unique `${username}::${ip}` combos to exhaust memory.
const LOGIN_BUCKETS_MAX = parseInt(process.env.LOGIN_BUCKETS_MAX || '50000', 10);

function getClientIp(req) {
    return req.ip || req.connection.remoteAddress || 'unknown';
}

function getLoginBucket(req, username = 'unknown') {
    return `${username}::${getClientIp(req)}`;
}

function evictExpiredLoginBuckets() {
    const now = Date.now();
    for (const [key, entry] of loginAttempts) {
        const stale = now - entry.firstAt > LOGIN_WINDOW_MS;
        const expired = !entry.lockedUntil || entry.lockedUntil <= now;
        if (stale && expired) loginAttempts.delete(key);
    }
}

function checkLoginRateLimit(bucket) {
    const now = Date.now();
    const entry = loginAttempts.get(bucket);
    if (!entry) return { blocked: false };
    if (entry.lockedUntil && entry.lockedUntil > now) {
        return { blocked: true, retryAfterMs: entry.lockedUntil - now };
    }
    return { blocked: false };
}

function recordLoginFailure(bucket) {
    const now = Date.now();
    // Evict before inserting so a flood of unique buckets can't bypass the cap.
    if (loginAttempts.size >= LOGIN_BUCKETS_MAX) {
        evictExpiredLoginBuckets();
        if (loginAttempts.size >= LOGIN_BUCKETS_MAX) {
            // Still full: drop oldest inserted entry (Map preserves insertion order).
            const firstKey = loginAttempts.keys().next().value;
            if (firstKey !== undefined) loginAttempts.delete(firstKey);
        }
    }

    const entry = loginAttempts.get(bucket) || { count: 0, firstAt: now, lockedUntil: 0 };

    if (now - entry.firstAt > LOGIN_WINDOW_MS) {
        entry.count = 0;
        entry.firstAt = now;
        entry.lockedUntil = 0;
    }

    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
        entry.count = 0;
        entry.firstAt = now;
    }

    loginAttempts.set(bucket, entry);
}

function clearLoginFailures(bucket) {
    loginAttempts.delete(bucket);
}

// Periodic GC of the attempts map. unref'd so it doesn't keep the event loop alive.
const loginEvictTimer = setInterval(evictExpiredLoginBuckets, Math.max(LOGIN_WINDOW_MS, 60000));
if (loginEvictTimer.unref) loginEvictTimer.unref();

// POST /api/auth/setup - First time admin account creation
router.post('/setup', async (req, res) => {
    if (getUserStore(req).isSetup()) {
        return res.status(400).json({ error: 'Admin account already exists' });
    }

    let username;
    let password;
    try {
        username = requireString(req.body.username, 'username', { max: 64 });
        password = requireString(req.body.password, 'password', { min: 6, max: 256, trim: false });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    getUserStore(req).createInitialAdmin(username, passwordHash);
    logger.info(`Admin account created: ${username}`);

    const token = signToken({ username, role: 'admin' });
    res.json({ token, username, role: 'admin' });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const attemptedUser = req.body?.username || 'unknown';
    const bucket = getLoginBucket(req, attemptedUser);
    const limitState = checkLoginRateLimit(bucket);
    if (limitState.blocked) {
        return res.status(429).json({
            error: 'Too many login attempts. Try again later.',
            retryAfterMs: limitState.retryAfterMs
        });
    }

    if (!getUserStore(req).isSetup()) {
        return res.status(503).json({ error: 'Panel not set up', setup: true });
    }

    let username;
    let password;
    try {
        username = requireString(req.body.username, 'username', { max: 64 });
        password = requireString(req.body.password, 'password', { min: 1, max: 256, trim: false });
    } catch (e) {
        recordLoginFailure(bucket);
        return res.status(400).json({ error: e.message });
    }

    const user = getUserStore(req).getUser(username);
    if (!user?.passwordHash) {
        recordLoginFailure(bucket);
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        recordLoginFailure(bucket);
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const role = user.role || (user.isAdmin ? 'admin' : 'viewer');

    // Check 2FA
    const twoFactorManager = req.app.locals.twoFactorManager;
    if (twoFactorManager && twoFactorManager.isEnabled(username)) {
        const totpCode = req.body?.totpCode;
        if (!totpCode) {
            return res.json({ requires2FA: true, username, role });
        }
        if (!twoFactorManager.verifyCode(username, totpCode)) {
            recordLoginFailure(bucket);
            return res.status(401).json({ error: 'Invalid 2FA code' });
        }
    }

    clearLoginFailures(bucket);

    const token = signToken({ username, role });
    logger.info(`User logged in: ${username} (${role})`);

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('auth.login', { username, role });
    }

    res.json({ token, username, role });
});

// POST /api/auth/logout — revoke the current token's jti so it can't be
// reused until its natural expiry. Safe to call without a valid token
// (idempotent from the client's perspective).
router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.json({ success: true });
    }

    const token = authHeader.slice(7);
    // API keys start with fp_ and aren't JWTs — nothing to revoke here.
    if (token.startsWith('fp_')) {
        return res.json({ success: true });
    }

    try {
        // Decode (NOT verify) — we want to revoke even slightly-malformed
        // tokens, as long as we can extract jti + exp. Verifying signature
        // first would reject an already-expired or tampered token and leak
        // that distinction to the caller.
        const decoded = jwt.verify(token, config.jwtSecret, { ignoreExpiration: true });
        const store = req.app.locals.revokedTokenStore;
        if (decoded?.jti && store) {
            store.revoke(decoded.jti, decoded.exp);
            logger.info(`Token revoked for ${decoded.username || 'unknown'}`);
            const activityLog = req.app.locals.activityLog;
            if (activityLog) {
                activityLog.log('auth.logout', { username: decoded.username }, decoded.username);
            }
        }
    } catch (_) {
        // Bad signature or malformed — nothing to revoke. Still return 200 so
        // the client can clear its own state.
    }
    res.json({ success: true });
});

// GET /api/auth/verify
router.get('/verify', (req, res) => {
    if (!getUserStore(req).isSetup()) {
        return res.status(503).json({ error: 'Panel not set up', setup: true });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token' });
    }

    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        res.json({ valid: true, username: decoded.username });
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) {
        return res.status(500).json({ error: 'Admin account not found' });
    }

    let currentPassword;
    let newPassword;
    try {
        currentPassword = requireString(req.body.currentPassword, 'currentPassword', { min: 1, max: 256, trim: false });
        newPassword = requireString(req.body.newPassword, 'newPassword', { min: 6, max: 256, trim: false });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    getUserStore(req).updatePassword(admin.username, await bcrypt.hash(newPassword, 10));
    logger.info('Admin password changed');
    res.json({ success: true });
});

// GET /api/auth/users - List all users (admin only)
router.get('/users', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) return res.status(500).json({ error: 'Admin account not found' });
    if (req.user.username !== admin.username && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only the admin can view users' });
    }

    const users = getUserStore(req).listUsers().map(u => ({
        username: u.username,
        role: u.role,
        createdAt: u.createdAt || null
    }));
    res.json({ users });
});

// POST /api/auth/users - Create a new user (admin only)
router.post('/users', authMiddleware, requireGlobalPermission('panel.users'), async (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) return res.status(500).json({ error: 'Admin account not found' });
    if (req.user.username !== admin.username) {
        return res.status(403).json({ error: 'Only the admin can manage users' });
    }

    let username;
    let password;
    const role = req.body.role;
    try {
        username = requireString(req.body.username, 'username', { max: 64 });
        password = requireString(req.body.password, 'password', { min: 6, max: 256, trim: false });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const validRoles = ['admin', 'operator', 'viewer'];
    if (role && !validRoles.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    if (username === admin.username || getUserStore(req).getUser(username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    getUserStore(req).createUser(username, await bcrypt.hash(password, 10), role || 'viewer');
    logger.info(`User created: ${username} (${role || 'viewer'})`);

    const activityLog = req.app.locals.activityLog;
    if (activityLog) {
        activityLog.log('user.create', { username, role: role || 'viewer' }, req.user.username);
    }

    res.json({ success: true, username, role: role || 'viewer' });
});

// DELETE /api/auth/users/:username - Delete a user (admin only)
router.delete('/users/:username', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) return res.status(500).json({ error: 'Admin account not found' });
    if (req.user.username !== admin.username) {
        return res.status(403).json({ error: 'Only the admin can manage users' });
    }
    if (req.params.username === admin.username) {
        return res.status(400).json({ error: 'Cannot delete the admin account' });
    }
    if (!getUserStore(req).getUser(req.params.username)) {
        return res.status(404).json({ error: 'User not found' });
    }

    getUserStore(req).deleteUser(req.params.username);
    logger.info(`User deleted: ${req.params.username}`);
    res.json({ success: true });
});

// PUT /api/auth/users/:username/role - Update user role (admin only)
router.put('/users/:username/role', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) return res.status(500).json({ error: 'Admin account not found' });
    if (req.user.username !== admin.username) {
        return res.status(403).json({ error: 'Only the admin can manage users' });
    }

    const role = req.body?.role;
    const validRoles = ['admin', 'operator', 'viewer'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    const user = getUserStore(req).getUser(req.params.username);
    if (!user || user.isAdmin) return res.status(404).json({ error: 'User not found' });

    getUserStore(req).updateUserRole(req.params.username, role);
    res.json({ success: true, username: req.params.username, role });
});

module.exports = router;
