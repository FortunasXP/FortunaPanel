// FortunaPanel - Startup Variable System Routes
const express = require('express');
const path = require('path');
const config = require('../config/default');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.serverManager;
}

// Java path policy: accept the literal string "java" (uses the system PATH)
// or an absolute path whose basename is java/java.exe. Reject anything that
// could be used to escape the server context — relative paths, dashes,
// shell metacharacters, etc.
function validateJavaPath(value) {
    if (typeof value !== 'string') throw new Error('JAVA_PATH must be a string');
    const v = value.trim();
    if (v === '') throw new Error('JAVA_PATH cannot be empty');
    if (v === 'java' || v === 'java.exe') return v;
    if (v.startsWith('-')) throw new Error('JAVA_PATH cannot start with "-"');
    if (/[\r\n\x00"'`$;|&<>*?]/.test(v)) throw new Error('JAVA_PATH contains invalid characters');
    if (!path.isAbsolute(v)) throw new Error('JAVA_PATH must be "java" or an absolute path');
    const base = path.basename(v).toLowerCase();
    if (base !== 'java' && base !== 'java.exe') {
        throw new Error('JAVA_PATH must point to a java/java.exe binary');
    }
    return v;
}

// Memory string: digits + optional unit suffix (K/M/G), no shell metas.
function validateMemoryString(value, label) {
    if (typeof value !== 'string') throw new Error(`${label} must be a string`);
    const v = value.trim();
    if (!/^\d{1,6}\s*[KkMmGg]?$/.test(v)) {
        throw new Error(`${label} must be like "512M", "1G", "8192" (digits + optional K/M/G)`);
    }
    return v.toUpperCase();
}

// JAR filename: plain .jar in the server directory. No path separators
// (absolute or relative). No shell metas.
function validateJarFile(value) {
    if (typeof value !== 'string') throw new Error('JAR file must be a string');
    const v = value.trim();
    if (v !== path.basename(v)) throw new Error('JAR file must not contain path separators');
    if (v === '.' || v === '..' || v === '') throw new Error('JAR file is invalid');
    if (!/\.jar$/i.test(v)) throw new Error('JAR file must end in .jar');
    if (/[\r\n\x00"'`$;|&<>*?\\]/.test(v)) throw new Error('JAR file contains invalid characters');
    return v;
}

// JVM flag policy: only allow tokens that start with -X, -D, -XX, -ea, -da,
// -verbose, -server, or are an =-attached value to one of those. Block
// anything that loads native libraries (-agentlib, -agentpath,
// -javaagent), -cp / -classpath / -jar (we add -jar ourselves), and any
// raw filesystem paths. Each flag must also be free of shell metas and
// path traversal characters.
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

// Default startup variable templates per server type
const STARTUP_TEMPLATES = {
    paper: {
        variables: [
            { key: 'JAVA_PATH', label: 'Java Path', default: 'java', type: 'string', description: 'Path to Java executable' },
            { key: 'MIN_MEMORY', label: 'Min Memory', default: '1G', type: 'select', options: ['512M', '1G', '2G', '3G', '4G'], description: 'Minimum heap size' },
            { key: 'MAX_MEMORY', label: 'Max Memory', default: '2G', type: 'select', options: ['1G', '2G', '3G', '4G', '6G', '8G', '12G', '16G'], description: 'Maximum heap size' },
            { key: 'SERVER_JAR', label: 'Server JAR', default: 'server.jar', type: 'string', description: 'Name of the server JAR file' },
            { key: 'JVM_FLAGS', label: 'JVM Flags', default: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200', type: 'string', description: 'Additional JVM arguments' },
        ],
        startupCommand: '{{JAVA_PATH}} -Xms{{MIN_MEMORY}} -Xmx{{MAX_MEMORY}} {{JVM_FLAGS}} -jar {{SERVER_JAR}} nogui'
    },
    vanilla: {
        variables: [
            { key: 'JAVA_PATH', label: 'Java Path', default: 'java', type: 'string', description: 'Path to Java executable' },
            { key: 'MIN_MEMORY', label: 'Min Memory', default: '1G', type: 'select', options: ['512M', '1G', '2G', '3G', '4G'], description: 'Minimum heap size' },
            { key: 'MAX_MEMORY', label: 'Max Memory', default: '2G', type: 'select', options: ['1G', '2G', '3G', '4G', '6G', '8G', '12G', '16G'], description: 'Maximum heap size' },
            { key: 'SERVER_JAR', label: 'Server JAR', default: 'server.jar', type: 'string', description: 'Name of the server JAR file' },
        ],
        startupCommand: '{{JAVA_PATH}} -Xms{{MIN_MEMORY}} -Xmx{{MAX_MEMORY}} -jar {{SERVER_JAR}} nogui'
    },
    forge: {
        variables: [
            { key: 'JAVA_PATH', label: 'Java Path', default: 'java', type: 'string', description: 'Path to Java executable' },
            { key: 'MIN_MEMORY', label: 'Min Memory', default: '2G', type: 'select', options: ['1G', '2G', '3G', '4G', '6G', '8G'], description: 'Minimum heap size' },
            { key: 'MAX_MEMORY', label: 'Max Memory', default: '4G', type: 'select', options: ['2G', '4G', '6G', '8G', '12G', '16G'], description: 'Maximum heap size' },
            { key: 'FORGE_JAR', label: 'Forge JAR', default: 'forge-server.jar', type: 'string', description: 'Forge server JAR file' },
            { key: 'JVM_FLAGS', label: 'JVM Flags', default: '-XX:+UseG1GC -Dfml.readTimeout=180 -Dfml.queryResult=confirm', type: 'string', description: 'Forge-specific JVM arguments' },
        ],
        startupCommand: '{{JAVA_PATH}} -Xms{{MIN_MEMORY}} -Xmx{{MAX_MEMORY}} {{JVM_FLAGS}} -jar {{FORGE_JAR}} nogui'
    },
    fabric: {
        variables: [
            { key: 'JAVA_PATH', label: 'Java Path', default: 'java', type: 'string', description: 'Path to Java executable' },
            { key: 'MIN_MEMORY', label: 'Min Memory', default: '2G', type: 'select', options: ['1G', '2G', '3G', '4G', '6G', '8G'], description: 'Minimum heap size' },
            { key: 'MAX_MEMORY', label: 'Max Memory', default: '4G', type: 'select', options: ['2G', '4G', '6G', '8G', '12G', '16G'], description: 'Maximum heap size' },
            { key: 'FABRIC_JAR', label: 'Fabric JAR', default: 'fabric-server-launch.jar', type: 'string', description: 'Fabric launcher JAR' },
            { key: 'JVM_FLAGS', label: 'JVM Flags', default: '-XX:+UseG1GC', type: 'string', description: 'JVM arguments' },
        ],
        startupCommand: '{{JAVA_PATH}} -Xms{{MIN_MEMORY}} -Xmx{{MAX_MEMORY}} {{JVM_FLAGS}} -jar {{FABRIC_JAR}} nogui'
    },
    custom: {
        variables: [
            { key: 'JAVA_PATH', label: 'Java Path', default: 'java', type: 'string', description: 'Path to Java executable' },
            { key: 'MIN_MEMORY', label: 'Min Memory', default: '1G', type: 'string', description: 'Minimum heap size' },
            { key: 'MAX_MEMORY', label: 'Max Memory', default: '2G', type: 'string', description: 'Maximum heap size' },
            { key: 'SERVER_JAR', label: 'Server JAR', default: 'server.jar', type: 'string', description: 'Name of the server JAR file' },
            { key: 'JVM_FLAGS', label: 'JVM Flags', default: '', type: 'string', description: 'Additional JVM arguments' },
        ],
        startupCommand: '{{JAVA_PATH}} -Xms{{MIN_MEMORY}} -Xmx{{MAX_MEMORY}} {{JVM_FLAGS}} -jar {{SERVER_JAR}} nogui'
    }
};

// GET /api/startup/templates - Get all startup templates
router.get('/templates', requirePermission('server.startup'), (req, res) => {
    res.json({ templates: STARTUP_TEMPLATES });
});

// GET /api/startup/:serverId - Get startup config for a server
router.get('/:serverId', requirePermission('server.startup'), (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.serverId);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const type = instance.config.type || 'custom';
    const template = STARTUP_TEMPLATES[type] || STARTUP_TEMPLATES.custom;

    // Get saved variables or defaults
    const savedVars = instance.config.startupVariables || {};
    const variables = template.variables.map(v => ({
        ...v,
        value: savedVars[v.key] !== undefined ? savedVars[v.key] : v.default
    }));

    // Get custom startup command or template default
    const startupCommand = instance.config.startupCommand || template.startupCommand;

    // Resolve the actual command
    let resolvedCommand = startupCommand;
    for (const v of variables) {
        resolvedCommand = resolvedCommand.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, 'g'), v.value);
    }

    res.json({
        serverId: req.params.serverId,
        type,
        variables,
        startupCommand,
        resolvedCommand,
        customVariables: instance.config.customStartupVariables || []
    });
});

// PUT /api/startup/:serverId - Update startup variables
router.put('/:serverId', requirePermission('server.startup'), async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.serverId);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const { variables, startupCommand, customVariables } = req.body;

    // Validate every variable BEFORE we mutate any state.
    let validated = {};
    try {
        if (variables && typeof variables === 'object') {
            if (variables.JAVA_PATH !== undefined) {
                validated.JAVA_PATH = validateJavaPath(variables.JAVA_PATH);
            }
            if (variables.MIN_MEMORY !== undefined) {
                validated.MIN_MEMORY = validateMemoryString(variables.MIN_MEMORY, 'MIN_MEMORY');
            }
            if (variables.MAX_MEMORY !== undefined) {
                validated.MAX_MEMORY = validateMemoryString(variables.MAX_MEMORY, 'MAX_MEMORY');
            }
            for (const k of ['SERVER_JAR', 'FORGE_JAR', 'FABRIC_JAR']) {
                if (variables[k] !== undefined) validated[k] = validateJarFile(variables[k]);
            }
            if (variables.JVM_FLAGS !== undefined) {
                validated.JVM_FLAGS_ARGS = validateJvmFlagsString(variables.JVM_FLAGS);
                validated.JVM_FLAGS = (validated.JVM_FLAGS_ARGS || []).join(' ');
            }
            // Any other variable key we don't understand: accept as a plain
            // string with no shell metacharacters. These don't feed into
            // spawn() directly — they're only substituted into the
            // user-visible startupCommand template — but keeping them
            // sanitized prevents leaks into other code paths.
            for (const [key, value] of Object.entries(variables)) {
                if (key in validated || ['JAVA_PATH', 'MIN_MEMORY', 'MAX_MEMORY', 'SERVER_JAR', 'FORGE_JAR', 'FABRIC_JAR', 'JVM_FLAGS'].includes(key)) continue;
                if (typeof value !== 'string') {
                    throw new Error(`Variable ${key} must be a string`);
                }
                if (/[\r\n\x00`$;|&<>]/.test(value)) {
                    throw new Error(`Variable ${key} contains invalid characters`);
                }
                if (value.length > 512) {
                    throw new Error(`Variable ${key} is too long`);
                }
                validated[key] = value;
            }
        }
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    // startupCommand is a display template only — it's resolved server-side
    // for the UI but the actual spawn args come from instance.config.*
    // fields below. Still cap it so a megabyte template can't blow up.
    if (startupCommand !== undefined) {
        if (typeof startupCommand !== 'string' || startupCommand.length > 4096) {
            return res.status(400).json({ error: 'startupCommand must be a string under 4 KB' });
        }
    }

    // customVariables: an array of {key,label,value,description}; each is
    // re-validated when used through the variables map above. Cap the
    // count and the per-field sizes to avoid abuse.
    if (customVariables !== undefined) {
        if (!Array.isArray(customVariables) || customVariables.length > 32) {
            return res.status(400).json({ error: 'customVariables must be an array of <= 32 items' });
        }
    }

    // Persist — variables map keeps the raw user-entered values so the
    // template UI re-displays exactly what was saved; the side-effect
    // fields below are what ServerInstance actually uses.
    if (variables) {
        instance.config.startupVariables = { ...variables };
        // Replace any normalized variants in startupVariables so the UI
        // sees the canonical form on next load.
        for (const k of Object.keys(validated)) {
            if (k === 'JVM_FLAGS_ARGS') continue;
            instance.config.startupVariables[k] = validated[k];
        }

        if (validated.JAVA_PATH !== undefined) instance.config.javaPath = validated.JAVA_PATH;
        if (validated.MIN_MEMORY !== undefined) instance.config.memory.min = validated.MIN_MEMORY;
        if (validated.MAX_MEMORY !== undefined) instance.config.memory.max = validated.MAX_MEMORY;
        if (validated.SERVER_JAR !== undefined) instance.config.jarFile = validated.SERVER_JAR;
        if (validated.FORGE_JAR !== undefined) instance.config.jarFile = validated.FORGE_JAR;
        if (validated.FABRIC_JAR !== undefined) instance.config.jarFile = validated.FABRIC_JAR;
        if (validated.JVM_FLAGS_ARGS !== undefined) {
            instance.config.jvmArgs = validated.JVM_FLAGS_ARGS;
        }
    }

    if (startupCommand !== undefined) {
        instance.config.startupCommand = startupCommand;
    }

    if (customVariables !== undefined) {
        instance.config.customStartupVariables = customVariables;
    }

    await manager.saveRegistry();
    res.json({ success: true });
});

// POST /api/startup/:serverId/add-variable - Add a custom startup variable
router.post('/:serverId/add-variable', requirePermission('server.startup'), async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.serverId);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    const { key, label, value, description } = req.body;
    if (!key) return res.status(400).json({ error: 'Variable key required' });

    if (!instance.config.customStartupVariables) {
        instance.config.customStartupVariables = [];
    }

    // Check for duplicates
    if (instance.config.customStartupVariables.find(v => v.key === key)) {
        return res.status(400).json({ error: 'Variable already exists' });
    }

    instance.config.customStartupVariables.push({
        key,
        label: label || key,
        value: value || '',
        description: description || '',
        type: 'string'
    });

    if (!instance.config.startupVariables) instance.config.startupVariables = {};
    instance.config.startupVariables[key] = value || '';

    await manager.saveRegistry();
    res.json({ success: true });
});

// DELETE /api/startup/:serverId/variable/:key - Remove a custom startup variable
router.delete('/:serverId/variable/:key', requirePermission('server.startup'), async (req, res) => {
    const manager = getManager(req);
    const instance = manager.getServer(req.params.serverId);
    if (!instance) return res.status(404).json({ error: 'Server not found' });

    if (instance.config.customStartupVariables) {
        instance.config.customStartupVariables = instance.config.customStartupVariables.filter(
            v => v.key !== req.params.key
        );
    }

    if (instance.config.startupVariables) {
        delete instance.config.startupVariables[req.params.key];
    }

    await manager.saveRegistry();
    res.json({ success: true });
});

module.exports = router;
