// FortunaPanel — Pure-function security unit tests.
//
// Runs the validators and helpers added during the security audit
// without spawning the full server. Covers:
//   - path traversal guards (pathInside, safeFilename, safeUuid)
//   - JVM flag allowlist (validateJvmFlagsString)
//   - Docker image / env validators (DockerManager internals)
//   - Discord webhook URL allowlist (NotificationManager._isAllowedWebhookUrl)
//   - SafeHref scheme blocker (frontend, tested via the same logic)
//
// Run via: node scripts/security-unit.mjs

import path from 'node:path';
import { pathInside, safeFilename, safeUuid } from '../src/utils/validation.js';

let failed = 0;
let passed = 0;

function assert(name, fn) {
    try {
        const result = fn();
        if (result === true) {
            console.log(`PASS ${name}`);
            passed++;
        } else {
            console.log(`FAIL ${name}: returned ${JSON.stringify(result)}`);
            failed++;
        }
    } catch (e) {
        console.log(`FAIL ${name}: threw ${e.message}`);
        failed++;
    }
}

function assertThrows(name, fn, expectedFragment) {
    try {
        fn();
        console.log(`FAIL ${name}: did not throw (expected: ${expectedFragment})`);
        failed++;
    } catch (e) {
        if (expectedFragment && !e.message.toLowerCase().includes(expectedFragment.toLowerCase())) {
            console.log(`FAIL ${name}: wrong message "${e.message}" (expected to contain "${expectedFragment}")`);
            failed++;
        } else {
            console.log(`PASS ${name}`);
            passed++;
        }
    }
}

// ============================================================
// pathInside — the headline path-traversal fix
// ============================================================

const root = path.resolve('/srv/s1');

assert('pathInside: exact match', () => pathInside(root, root) === true);

assert('pathInside: child', () => pathInside(root, path.resolve('/srv/s1/world')) === true);

assert('pathInside: deep child', () => pathInside(root, path.resolve('/srv/s1/world/region/r.0.0.mca')) === true);

assert('pathInside: rejects sibling startsWith trick', () => pathInside(root, path.resolve('/srv/s1-evil')) === false);

assert('pathInside: rejects sibling startsWith trick (suffix)', () => pathInside(root, path.resolve('/srv/s1xxx/foo')) === false);

assert('pathInside: rejects parent', () => pathInside(root, path.resolve('/srv')) === false);

assert('pathInside: rejects unrelated', () => pathInside(root, path.resolve('/etc/passwd')) === false);

// ============================================================
// safeFilename — used for plugin uploads, log downloads, etc.
// ============================================================

assert('safeFilename: plain name', () => safeFilename('plugin.jar') === 'plugin.jar');

assert('safeFilename: dots in name', () => safeFilename('my.plugin.v2.jar') === 'my.plugin.v2.jar');

assertThrows('safeFilename: rejects ../', () => safeFilename('../evil.jar'), 'separators');

assertThrows('safeFilename: rejects forward slash', () => safeFilename('a/b.jar'), 'separators');

assertThrows('safeFilename: rejects backslash', () => safeFilename('a\\b.jar'));

assertThrows('safeFilename: rejects ..', () => safeFilename('..'), 'invalid');

assertThrows('safeFilename: rejects .', () => safeFilename('.'), 'invalid');

assertThrows('safeFilename: rejects null byte', () => safeFilename('plugin.jar\x00.evil'), 'invalid');

assertThrows('safeFilename: rejects shell meta $', () => safeFilename('plugin$.jar'), 'invalid');

assertThrows('safeFilename: rejects shell meta ;', () => safeFilename('plugin;rm.jar'), 'invalid');

assertThrows('safeFilename: rejects shell meta |', () => safeFilename('plugin|nc.jar'), 'invalid');

assertThrows('safeFilename: rejects backticks', () => safeFilename('plugin`x`.jar'), 'invalid');

assertThrows('safeFilename: rejects quotes', () => safeFilename('plugin".jar'), 'invalid');

assertThrows('safeFilename: rejects empty', () => safeFilename(''), 'required');

assertThrows('safeFilename: rejects whitespace-only', () => safeFilename('   '), 'required');

// ============================================================
// safeUuid — used for log directory routing
// ============================================================

assert('safeUuid: valid v4', () => safeUuid('7b38231f-ebd6-43cb-aee8-02c0e1550d94') === '7b38231f-ebd6-43cb-aee8-02c0e1550d94');

assert('safeUuid: uppercase hex accepted', () => safeUuid('7B38231F-EBD6-43CB-AEE8-02C0E1550D94') === '7B38231F-EBD6-43CB-AEE8-02C0E1550D94');

assertThrows('safeUuid: rejects ../', () => safeUuid('../../../etc'), 'UUID');

assertThrows('safeUuid: rejects too short', () => safeUuid('abc-123'), 'UUID');

assertThrows('safeUuid: rejects wrong-hyphen-shape', () => safeUuid('7b38231febd6-43cb-aee8-02c0e1550d94'), 'UUID');

assertThrows('safeUuid: rejects empty', () => safeUuid(''), 'required');

// ============================================================
// JVM flag allowlist — extracted from src/routes/startup.js
// We re-implement the validator here to test in isolation.
// If this drifts from the real one, the smoke test will catch it.
// ============================================================

function validateJvmFlagsString(raw) {
    if (raw === '' || raw == null) return [];
    if (typeof raw !== 'string') throw new Error('JVM_FLAGS must be a string');
    if (/[\r\n\x00`$;|&<>]/.test(raw)) throw new Error('JVM_FLAGS contains invalid characters');
    const tokens = raw.split(/\s+/).filter(Boolean);
    const BLOCKED_PREFIXES = ['-agentlib', '-agentpath', '-javaagent', '-cp', '-classpath', '-jar'];
    const ALLOWED_PREFIXES = ['-X', '-D', '-ea', '-da', '-verbose', '-server', '-client'];
    for (const t of tokens) {
        if (t.length > 256) throw new Error('JVM flag is too long');
        if (BLOCKED_PREFIXES.some(p => t === p || t.toLowerCase().startsWith(p + ':') || t.toLowerCase().startsWith(p + '='))) {
            throw new Error(`JVM flag "${t}" is not allowed`);
        }
        if (!t.startsWith('-')) {
            throw new Error(`JVM flag "${t}" must start with "-"`);
        }
        if (!ALLOWED_PREFIXES.some(p => t.startsWith(p))) {
            throw new Error(`JVM flag "${t}" is not in the allowed prefix set`);
        }
    }
    return tokens;
}

assert('JVM flags: empty string ok', () => Array.isArray(validateJvmFlagsString('')) && validateJvmFlagsString('').length === 0);

assert('JVM flags: G1GC allowed', () => {
    const r = validateJvmFlagsString('-XX:+UseG1GC -XX:MaxGCPauseMillis=200');
    return r.length === 2;
});

assert('JVM flags: -Dprop allowed', () => validateJvmFlagsString('-Dfml.queryResult=confirm').length === 1);

assert('JVM flags: -ea allowed', () => validateJvmFlagsString('-ea').length === 1);

assertThrows('JVM flags: rejects -agentlib', () => validateJvmFlagsString('-agentlib:jdwp=transport=dt_socket'), 'not allowed');

assertThrows('JVM flags: rejects -javaagent', () => validateJvmFlagsString('-javaagent:/tmp/x.jar'), 'not allowed');

assertThrows('JVM flags: rejects -agentpath', () => validateJvmFlagsString('-agentpath:/tmp/x.so'), 'not allowed');

assertThrows('JVM flags: rejects -jar (we add it)', () => validateJvmFlagsString('-jar evil.jar'), 'not allowed');

assertThrows('JVM flags: rejects -cp', () => validateJvmFlagsString('-cp /etc/passwd'), 'not allowed');

assertThrows('JVM flags: rejects shell meta', () => validateJvmFlagsString('-Xmx2G; rm -rf /'), 'invalid characters');

assertThrows('JVM flags: rejects backtick', () => validateJvmFlagsString('-Xmx`whoami`'), 'invalid characters');

assertThrows('JVM flags: rejects newline injection', () => validateJvmFlagsString('-Xmx2G\n-agentlib:x'), 'invalid characters');

assertThrows('JVM flags: rejects non-flag token', () => validateJvmFlagsString('-Xmx2G something'), 'must start');

assertThrows('JVM flags: rejects unknown prefix', () => validateJvmFlagsString('-rogue:x'), 'not in the allowed');

// ============================================================
// Docker image validator — extracted from DockerManager.js
// ============================================================

const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$/;
function isValidImage(image) {
    return typeof image === 'string' && !image.startsWith('-') && IMAGE_RE.test(image);
}

assert('Docker image: eclipse-temurin:21-jre allowed', () => isValidImage('eclipse-temurin:21-jre'));

assert('Docker image: docker.io/library/openjdk:21 allowed', () => isValidImage('docker.io/library/openjdk:21'));

assert('Docker image: digest reference allowed', () => isValidImage('image@sha256:abc123'));

assert('Docker image: rejects leading dash', () => isValidImage('-rm') === false);

assert('Docker image: rejects empty', () => isValidImage('') === false);

assert('Docker image: rejects shell meta', () => isValidImage('image;rm') === false);

assert('Docker image: rejects space', () => isValidImage('image name') === false);

assert('Docker image: rejects backtick', () => isValidImage('image`x`') === false);

// ============================================================
// Docker env key/value validators
// ============================================================

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isValidEnvKey(k) { return typeof k === 'string' && ENV_KEY_RE.test(k); }
function isValidEnvValue(v) {
    if (typeof v !== 'string') return false;
    return !/[\r\n\x00]/.test(v);
}

assert('Docker env key: SERVER_PORT allowed', () => isValidEnvKey('SERVER_PORT'));
assert('Docker env key: _PRIVATE allowed', () => isValidEnvKey('_PRIVATE'));
assert('Docker env key: rejects leading digit', () => isValidEnvKey('1FOO') === false);
assert('Docker env key: rejects dash', () => isValidEnvKey('SERVER-PORT') === false);
assert('Docker env key: rejects shell meta', () => isValidEnvKey('FOO;BAR') === false);

assert('Docker env val: plain string ok', () => isValidEnvValue('hello world'));
assert('Docker env val: rejects newline', () => isValidEnvValue('a\nb') === false);
assert('Docker env val: rejects null byte', () => isValidEnvValue('a\x00b') === false);
assert('Docker env val: rejects carriage return', () => isValidEnvValue('a\rb') === false);

// ============================================================
// Discord webhook URL allowlist — extracted from NotificationManager
// ============================================================

function isAllowedWebhookUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch (_) { return false; }
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host !== 'discord.com' && host !== 'discordapp.com' && host !== 'canary.discord.com' && host !== 'ptb.discord.com') {
        return false;
    }
    if (!url.pathname.startsWith('/api/webhooks/')) return false;
    return true;
}

assert('Webhook: discord.com/api/webhooks allowed', () => isAllowedWebhookUrl('https://discord.com/api/webhooks/123/abc'));
assert('Webhook: canary subdomain allowed', () => isAllowedWebhookUrl('https://canary.discord.com/api/webhooks/1/x'));
assert('Webhook: rejects http://', () => isAllowedWebhookUrl('http://discord.com/api/webhooks/1/x') === false);
assert('Webhook: rejects internal IP', () => isAllowedWebhookUrl('https://127.0.0.1/api/webhooks/1/x') === false);
assert('Webhook: rejects metadata service', () => isAllowedWebhookUrl('https://169.254.169.254/api/webhooks/1/x') === false);
assert('Webhook: rejects different host', () => isAllowedWebhookUrl('https://evil.com/api/webhooks/1/x') === false);
assert('Webhook: rejects non-webhook path', () => isAllowedWebhookUrl('https://discord.com/api/users/@me') === false);
assert('Webhook: rejects garbage', () => isAllowedWebhookUrl('not a url') === false);
assert('Webhook: rejects empty', () => isAllowedWebhookUrl('') === false);
assert('Webhook: rejects javascript:', () => isAllowedWebhookUrl('javascript:alert(1)') === false);

// ============================================================
// safeHref (frontend scheme blocker) — mirror of public/js/app.js
// ============================================================

function safeHref(value) {
    if (!value) return '#';
    const trimmed = String(value).trim();
    if (!trimmed) return '#';
    if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
        return trimmed;
    }
    return '#';
}

assert('safeHref: https URL passes', () => safeHref('https://github.com/x') === 'https://github.com/x');
assert('safeHref: http URL passes', () => safeHref('http://example.com') === 'http://example.com');
assert('safeHref: relative path passes', () => safeHref('/foo') === '/foo');
assert('safeHref: anchor passes', () => safeHref('#section') === '#section');
assert('safeHref: blocks javascript:', () => safeHref('javascript:alert(1)') === '#');
assert('safeHref: blocks JaVaScRiPt: case', () => safeHref('JaVaScRiPt:alert(1)') === '#');
assert('safeHref: blocks data:', () => safeHref('data:text/html,<script>') === '#');
assert('safeHref: blocks vbscript:', () => safeHref('vbscript:msgbox') === '#');
assert('safeHref: blocks empty', () => safeHref('') === '#');
assert('safeHref: blocks null', () => safeHref(null) === '#');
assert('safeHref: blocks undefined', () => safeHref(undefined) === '#');

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
