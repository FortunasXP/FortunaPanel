function parse(content) {
    const result = {};
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        result[key] = value;
    }

    return result;
}

function stringify(obj, originalContent) {
    if (originalContent) {
        // Preserve comments and order from original
        const lines = originalContent.split('\n');
        const result = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;

            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) return line;

            const key = trimmed.substring(0, eqIndex).trim();
            if (key in obj) {
                return `${key}=${obj[key]}`;
            }
            return line;
        });

        // Add any new keys not in original
        const existingKeys = new Set();
        for (const line of lines) {
            const eqIndex = line.indexOf('=');
            if (eqIndex > 0 && !line.trim().startsWith('#')) {
                existingKeys.add(line.substring(0, eqIndex).trim());
            }
        }
        for (const [key, value] of Object.entries(obj)) {
            if (!existingKeys.has(key)) {
                result.push(`${key}=${value}`);
            }
        }

        return result.join('\n');
    }

    return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

const PROPERTY_METADATA = {
    'server-port': { type: 'number', min: 1, max: 65535, category: 'network', description: 'Port the server listens on', default: '25565' },
    'server-ip': { type: 'string', category: 'network', description: 'IP to bind to (leave blank for all)', default: '' },
    'online-mode': { type: 'boolean', category: 'network', description: 'Verify accounts with Mojang', default: 'true' },
    'enable-query': { type: 'boolean', category: 'network', description: 'Enable GameSpy4 protocol server listener', default: 'false' },
    'query.port': { type: 'number', min: 1, max: 65535, category: 'network', description: 'Query port', default: '25565' },
    'enable-rcon': { type: 'boolean', category: 'network', description: 'Enable remote console', default: 'false' },
    'rcon.port': { type: 'number', min: 1, max: 65535, category: 'network', description: 'RCON port', default: '25575' },
    'rcon.password': { type: 'string', category: 'network', description: 'RCON password', default: '' },
    'gamemode': { type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'], category: 'gameplay', description: 'Default game mode', default: 'survival' },
    'difficulty': { type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'], category: 'gameplay', description: 'Server difficulty', default: 'easy' },
    'hardcore': { type: 'boolean', category: 'gameplay', description: 'Hardcore mode', default: 'false' },
    'pvp': { type: 'boolean', category: 'gameplay', description: 'Allow PvP', default: 'true' },
    'max-players': { type: 'number', min: 1, max: 999999, category: 'gameplay', description: 'Maximum players', default: '20' },
    'motd': { type: 'string', category: 'general', description: 'Server list message', default: 'A Minecraft Server' },
    'level-name': { type: 'string', category: 'world', description: 'World folder name', default: 'world' },
    'level-seed': { type: 'string', category: 'world', description: 'World seed', default: '' },
    'level-type': { type: 'string', category: 'world', description: 'World type', default: 'minecraft\\:normal' },
    'generate-structures': { type: 'boolean', category: 'world', description: 'Generate structures', default: 'true' },
    'spawn-animals': { type: 'boolean', category: 'world', description: 'Allow animal spawning', default: 'true' },
    'spawn-monsters': { type: 'boolean', category: 'world', description: 'Allow monster spawning', default: 'true' },
    'spawn-npcs': { type: 'boolean', category: 'world', description: 'Allow NPC spawning', default: 'true' },
    'allow-nether': { type: 'boolean', category: 'world', description: 'Allow Nether', default: 'true' },
    'view-distance': { type: 'number', min: 2, max: 32, category: 'performance', description: 'View distance in chunks', default: '10' },
    'simulation-distance': { type: 'number', min: 2, max: 32, category: 'performance', description: 'Simulation distance in chunks', default: '10' },
    'max-tick-time': { type: 'number', min: -1, max: 999999, category: 'performance', description: 'Max tick time before crash (ms, -1 to disable)', default: '60000' },
    'network-compression-threshold': { type: 'number', min: -1, max: 999999, category: 'performance', description: 'Network compression threshold', default: '256' },
    'white-list': { type: 'boolean', category: 'security', description: 'Enable whitelist', default: 'false' },
    'enforce-whitelist': { type: 'boolean', category: 'security', description: 'Kick non-whitelisted on reload', default: 'false' },
    'allow-flight': { type: 'boolean', category: 'security', description: 'Allow flight', default: 'false' },
    'spawn-protection': { type: 'number', min: 0, max: 999, category: 'security', description: 'Spawn protection radius', default: '16' },
    'enable-command-block': { type: 'boolean', category: 'general', description: 'Enable command blocks', default: 'false' },
    'force-gamemode': { type: 'boolean', category: 'gameplay', description: 'Force default gamemode on join', default: 'false' },
};

module.exports = { parse, stringify, PROPERTY_METADATA };
