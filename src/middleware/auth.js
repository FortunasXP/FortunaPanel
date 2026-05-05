const jwt = require('jsonwebtoken');
const config = require('../config/default');

function authMiddleware(req, res, next) {
    // Extract token from Authorization header
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const bearer = authHeader.slice(7);

        // Check if it's an API key (starts with fp_)
        if (bearer.startsWith('fp_')) {
            return apiKeyAuth(req, res, next, bearer);
        }

        token = bearer;
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, config.jwtSecret, { maxAge: config.jwtMaxSeconds });
        // Reject tokens whose lifetime exceeds our configured cap, even if
        // the signature is valid — guards against mistakes in token issuance.
        if (decoded.iat && decoded.exp && (decoded.exp - decoded.iat) > config.jwtMaxSeconds) {
            return res.status(401).json({ error: 'Token lifetime exceeds allowed maximum' });
        }
        // Revocation check: /api/auth/logout puts the token's jti here.
        const revokedStore = req.app.locals.revokedTokenStore;
        if (decoded.jti && revokedStore && revokedStore.isRevoked(decoded.jti)) {
            return res.status(401).json({ error: 'Token has been revoked' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function apiKeyAuth(req, res, next, apiKey) {
    const apiKeyManager = req.app.locals.apiKeyManager;
    if (!apiKeyManager) {
        return res.status(401).json({ error: 'API key auth not available' });
    }

    const keyEntry = apiKeyManager.validateKey(apiKey);
    if (!keyEntry) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check IP whitelist
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!apiKeyManager.isIPAllowed(keyEntry, clientIP)) {
        return res.status(403).json({ error: 'IP not allowed for this API key' });
    }

    // Set user info from API key
    req.user = {
        username: keyEntry.username,
        role: keyEntry.type === 'application' ? 'admin' : 'operator',
        apiKey: true,
        keyId: keyEntry.id,
        keyType: keyEntry.type,
        permissions: keyEntry.permissions,
        allowedServers: keyEntry.allowedServers
    };

    next();
}

function verifyToken(token) {
    try {
        return jwt.verify(token, config.jwtSecret);
    } catch (err) {
        return null;
    }
}

// Permission checking middleware factory
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.user || !req.user.username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const apiKeyManager = req.app.locals.apiKeyManager;
        const permissionManager = req.app.locals.permissionManager;
        const serverId =
            req.params.id ||
            req.params.serverId ||
            req.body?.serverId ||
            req.query?.serverId ||
            null;

        // API key with limited server access
        if (req.user.apiKey && req.user.allowedServers?.length > 0) {
            if (serverId && !req.user.allowedServers.includes(serverId)) {
                return res.status(403).json({ error: 'API key does not have access to this server' });
            }
        }

        // API keys have their own permission model
        if (req.user.apiKey) {
            if (!apiKeyManager) {
                return res.status(401).json({ error: 'API key auth not available' });
            }
            const keyEntry = apiKeyManager.getKeyById(req.user.keyId);
            if (!keyEntry || !apiKeyManager.hasPermission(keyEntry, permission, serverId)) {
                return res.status(403).json({ error: `API key permission denied: ${permission}` });
            }
            return next();
        }

        if (!permissionManager) return next();

        if (!permissionManager.hasPermission(req.user.username, serverId, permission)) {
            return res.status(403).json({ error: `Permission denied: ${permission}` });
        }

        next();
    };
}

function requireGlobalPermission(permission) {
    return (req, res, next) => {
        if (!req.user || !req.user.username) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const apiKeyManager = req.app.locals.apiKeyManager;
        const permissionManager = req.app.locals.permissionManager;

        if (req.user.apiKey) {
            if (!apiKeyManager) {
                return res.status(401).json({ error: 'API key auth not available' });
            }
            const keyEntry = apiKeyManager.getKeyById(req.user.keyId);
            if (!keyEntry || !apiKeyManager.hasPermission(keyEntry, permission, null)) {
                return res.status(403).json({ error: `API key permission denied: ${permission}` });
            }
            return next();
        }

        if (!permissionManager) return next();
        if (!permissionManager.hasPermission(req.user.username, null, permission)) {
            return res.status(403).json({ error: `Permission denied: ${permission}` });
        }

        next();
    };
}

module.exports = { authMiddleware, verifyToken, requirePermission, requireGlobalPermission };
