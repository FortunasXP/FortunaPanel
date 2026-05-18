const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../config/default');
const logger = require('../utils/logger');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const { asyncRoute } = require('../utils/http');
const { requireString } = require('../utils/validation');
const UserStore = require('../managers/UserStore');
const RevokedTokenStore = require('../managers/RevokedTokenStore');

// Username format: alphanumeric, underscores, hyphens (prevents stored XSS)
const USERNAME_REGEX = /^[a-zA-Z0-9_\-]+$/;

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
router.post('/setup', asyncRoute(async (req, res) => {
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

    if (!USERNAME_REGEX.test(username)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    getUserStore(req).createInitialAdmin(username, passwordHash);
    logger.info(`Admin account created: ${username}`);

    const token = signToken({ username, role: 'admin' });
    res.json({ token, username, role: 'admin' });
}));

// POST /api/auth/login
router.post('/login', asyncRoute(async (req, res) => {
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
}));

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
router.post('/change-password', authMiddleware, asyncRoute(async (req, res) => {
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
}));

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

    if (!USERNAME_REGEX.test(username)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
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

// POST /api/auth/users/:username/reset-password - Generate a password reset token (admin only)
router.post('/users/:username/reset-password', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) return res.status(500).json({ error: 'Admin account not found' });
    if (req.user.username !== admin.username && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can reset passwords' });
    }

    const target = getUserStore(req).getUser(req.params.username);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Invite manager not available' });

    const token = inviteManager.createResetToken(req.params.username, req.user.username);
    logger.info(`Password reset token created for ${req.params.username} by ${req.user.username}`);
    res.json({ code: token.code, expiresAt: token.expiresAt });
});

// POST /api/auth/reset-password - Redeem a reset token and set new password (no auth required)
router.post('/reset-password', asyncRoute(async (req, res) => {
    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Not available' });

    const { code, newPassword } = req.body;
    if (!code || !newPassword) return res.status(400).json({ error: 'Code and new password required' });
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Atomically claim the reset token. Read-only redeemResetToken would
    // let two simultaneous requests both pass and reset the password
    // twice (the second with whatever password it sent).
    const token = inviteManager.claimResetToken(code);
    if (!token) return res.status(400).json({ error: 'Invalid or expired reset code' });

    const user = getUserStore(req).getUser(token.username);
    if (!user) return res.status(400).json({ error: 'User no longer exists' });

    getUserStore(req).updatePassword(token.username, await bcrypt.hash(newPassword, 10));
    logger.info(`Password reset completed for ${token.username}`);
    res.json({ success: true, username: token.username });
}));

// POST /api/auth/invites - Create an invite link (admin only)
router.post('/invites', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const admin = getUserStore(req).getAdmin();
    if (!admin) return res.status(500).json({ error: 'Admin account not found' });
    if (req.user.username !== admin.username && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can create invites' });
    }

    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Invite manager not available' });

    const role = req.body.role || 'viewer';
    const validRoles = ['admin', 'operator', 'viewer'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    const expiryHours = Math.min(Math.max(parseInt(req.body.expiryHours) || 48, 1), 720); // 1h to 30d
    const invite = inviteManager.createInvite(role, req.user.username, expiryHours);
    res.json({ code: invite.code, role: invite.role, expiresAt: invite.expiresAt });
});

// GET /api/auth/invites - List all invites (admin only)
router.get('/invites', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Invite manager not available' });
    res.json({ invites: inviteManager.listInvites() });
});

// DELETE /api/auth/invites/:code - Delete an invite (admin only)
router.delete('/invites/:code', authMiddleware, requireGlobalPermission('panel.users'), (req, res) => {
    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Invite manager not available' });
    inviteManager.deleteInvite(req.params.code);
    res.json({ success: true });
});

// GET /api/auth/invite/:code - Validate an invite code (no auth required)
router.get('/invite/:code', (req, res) => {
    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Not available' });

    const invite = inviteManager.redeemInvite(req.params.code);
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invite' });
    res.json({ valid: true, role: invite.role, expiresAt: invite.expiresAt });
});

// POST /api/auth/invite/redeem - Redeem an invite and create account (no auth required)
router.post('/invite/redeem', asyncRoute(async (req, res) => {
    const inviteManager = req.app.locals.inviteManager;
    if (!inviteManager) return res.status(503).json({ error: 'Not available' });

    const { code, username, password } = req.body;
    if (!code || !username || !password) {
        return res.status(400).json({ error: 'Code, username, and password required' });
    }

    let safeUsername;
    try {
        safeUsername = requireString(username, 'username', { max: 64 });
        requireString(password, 'password', { min: 6, max: 256, trim: false });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    // Validate username format (alphanumeric, underscores, hyphens only)
    if (!USERNAME_REGEX.test(safeUsername)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
    }

    // Username availability is checked FIRST so we don't waste the invite
    // on a collision. The atomic claim then prevents two concurrent
    // redemptions of the same code (the read-mutate-save is synchronous).
    if (getUserStore(req).getUser(safeUsername)) {
        return res.status(400).json({ error: 'Username already taken' });
    }

    const invite = inviteManager.claimInvite(code, safeUsername);
    if (!invite) return res.status(400).json({ error: 'Invalid or expired invite' });

    let passwordHash;
    try {
        passwordHash = await bcrypt.hash(password, 10);
    } catch (e) {
        // bcrypt failed AFTER we claimed the invite. Restore it so the
        // user can retry. (Best-effort; if the file write fails the
        // invite stays burned — better than silent re-use.)
        try {
            const t = inviteManager._data.tokens.find(x => x.code === code && x.type === 'invite');
            if (t) { t.used = false; delete t.usedBy; delete t.usedAt; inviteManager._save(); }
        } catch (_) {}
        throw e;
    }

    // Final race window: someone could have created the user between our
    // pre-check and now. Guard with another check.
    if (getUserStore(req).getUser(safeUsername)) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    getUserStore(req).createUser(safeUsername, passwordHash, invite.role);

    logger.info(`User ${safeUsername} created via invite (role: ${invite.role})`);

    const token = signToken({ username: safeUsername, role: invite.role });
    res.json({ token, username: safeUsername, role: invite.role });
}));

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
