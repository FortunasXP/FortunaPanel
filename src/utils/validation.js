const path = require('path');
const { badRequest } = require('./http');

function requireString(value, field, { min = 1, max = null, trim = true } = {}) {
    if (typeof value !== 'string') {
        throw badRequest(`${field} must be a string`);
    }
    const normalized = trim ? value.trim() : value;
    if (normalized.length < min) {
        throw badRequest(`${field} is required`);
    }
    if (max !== null && normalized.length > max) {
        throw badRequest(`${field} is too long`);
    }
    return normalized;
}

function optionalString(value, field, { max = null, trim = true } = {}) {
    if (value === undefined || value === null || value === '') return null;
    return requireString(value, field, { min: 1, max, trim });
}

function requireNumber(value, field, { min = null, max = null, integer = false } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw badRequest(`${field} must be a number`);
    }
    if (integer && !Number.isInteger(n)) {
        throw badRequest(`${field} must be an integer`);
    }
    if (min !== null && n < min) {
        throw badRequest(`${field} must be >= ${min}`);
    }
    if (max !== null && n > max) {
        throw badRequest(`${field} must be <= ${max}`);
    }
    return n;
}

function requireEnum(value, field, allowed) {
    if (!allowed.includes(value)) {
        throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
    }
    return value;
}

function optionalBoolean(value) {
    if (value === undefined || value === null) return undefined;
    return !!value;
}

// Safe filename: no path separators, no traversal, no control chars, no shell metachars.
// Use for any filename that will be joined into a filesystem path or used in a shell command.
function safeFilename(value, field = 'filename', { maxLength = 255 } = {}) {
    const name = requireString(value, field, { max: maxLength });
    if (name !== path.basename(name)) {
        throw badRequest(`${field} contains path separators`);
    }
    if (name === '.' || name === '..') {
        throw badRequest(`${field} is invalid`);
    }
    // Reject control chars, quotes, backticks, $, ;, |, &, <, >, *, ?, null bytes
    if (/[\x00-\x1f"'`$;|&<>*?\\]/.test(name)) {
        throw badRequest(`${field} contains invalid characters`);
    }
    return name;
}

// Minecraft username: 3-16 chars, alphanumeric + underscore.
function safeMinecraftUsername(value, field = 'player') {
    const name = requireString(value, field);
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(name)) {
        throw badRequest(`${field} must be 1-16 alphanumeric/underscore characters`);
    }
    return name;
}

// Single Minecraft console line: no newlines (which would inject additional commands),
// limited length, printable ASCII only (plus space).
function safeConsoleLine(value, field = 'line', { maxLength = 500 } = {}) {
    const line = requireString(value, field, { max: maxLength });
    if (/[\r\n\x00]/.test(line)) {
        throw badRequest(`${field} must not contain newlines or null bytes`);
    }
    return line;
}

// IPv4 or IPv6 address.
function safeIpAddress(value, field = 'ip') {
    const ip = requireString(value, field, { max: 45 });
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^[0-9a-fA-F:]+$/;
    if (!ipv4.test(ip) && !ipv6.test(ip)) {
        throw badRequest(`${field} is not a valid IP address`);
    }
    if (ipv4.test(ip)) {
        const parts = ip.split('.').map(Number);
        if (parts.some(p => p < 0 || p > 255)) {
            throw badRequest(`${field} is not a valid IP address`);
        }
    }
    return ip;
}

// Numeric PID. Returns the string (not the number) so it can be used in shell safely.
function safePid(value, field = 'pid') {
    const pid = String(value);
    if (!/^\d{1,10}$/.test(pid)) {
        throw new Error(`${field} is not a valid PID`);
    }
    return pid;
}

// Path-separator-aware containment check. Guards against the classic
// startsWith bug where rootDir="/srv/s1" permits "/srv/s1-evil".
// Both inputs MUST be absolute paths (call path.resolve first).
function pathInside(rootDir, candidate) {
    if (candidate === rootDir) return true;
    const sep = path.sep;
    const withSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
    return candidate.startsWith(withSep);
}

// UUID v4 validator — used for server IDs in URL params. Returns the
// trimmed string on success; throws otherwise. Rejects path-traversal
// characters and any other input shape.
function safeUuid(value, field = 'id') {
    const v = requireString(value, field, { max: 64 });
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
        throw badRequest(`${field} is not a valid UUID`);
    }
    return v;
}

module.exports = {
    requireString,
    optionalString,
    requireNumber,
    requireEnum,
    optionalBoolean,
    safeFilename,
    safeMinecraftUsername,
    safeConsoleLine,
    safeIpAddress,
    safePid,
    pathInside,
    safeUuid
};
