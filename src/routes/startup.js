// FortunaPanel - Startup Variable System Routes
const express = require('express');
const { authMiddleware, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.serverManager;
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

    // Save variables
    if (variables) {
        instance.config.startupVariables = {};
        for (const [key, value] of Object.entries(variables)) {
            instance.config.startupVariables[key] = value;
        }

        // Apply variables to the actual config used by ServerInstance
        if (variables.JAVA_PATH) instance.config.javaPath = variables.JAVA_PATH;
        if (variables.MIN_MEMORY) instance.config.memory.min = variables.MIN_MEMORY;
        if (variables.MAX_MEMORY) instance.config.memory.max = variables.MAX_MEMORY;
        if (variables.SERVER_JAR) instance.config.jarFile = variables.SERVER_JAR;
        if (variables.FORGE_JAR) instance.config.jarFile = variables.FORGE_JAR;
        if (variables.FABRIC_JAR) instance.config.jarFile = variables.FABRIC_JAR;
        if (variables.JVM_FLAGS !== undefined) {
            instance.config.jvmArgs = variables.JVM_FLAGS ? variables.JVM_FLAGS.split(/\s+/).filter(Boolean) : [];
        }
    }

    // Save custom startup command
    if (startupCommand !== undefined) {
        instance.config.startupCommand = startupCommand;
    }

    // Save custom user-defined variables
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
