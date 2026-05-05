// FortunaPanel - Server Detector
// Scans a directory and detects Minecraft server configuration
const fs = require('fs');
const path = require('path');

const JAR_PATTERNS = [
    { regex: /^velocity-(.+?)\.jar$/i, type: 'velocity' },
    { regex: /^BungeeCord\.jar$/i, type: 'bungeecord' },
    { regex: /^bungeecord-(.+?)\.jar$/i, type: 'bungeecord' },
    { regex: /^paper-(.+?)\.jar$/i, type: 'paper' },
    { regex: /^purpur-(.+?)\.jar$/i, type: 'purpur' },
    { regex: /^spigot-(.+?)\.jar$/i, type: 'spigot' },
    { regex: /^craftbukkit-(.+?)\.jar$/i, type: 'craftbukkit' },
    { regex: /^forge-(.+?)\.jar$/i, type: 'forge' },
    { regex: /^fabric-server-launch\.jar$/i, type: 'fabric' },
    { regex: /^server\.jar$/i, type: 'vanilla' },
];

const PROXY_TYPES = ['velocity', 'bungeecord'];

function isProxyType(type) {
    return PROXY_TYPES.includes(type);
}

function detectServerConfig(directory) {
    if (!fs.existsSync(directory)) {
        throw new Error('Directory does not exist');
    }

    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) {
        throw new Error('Path is not a directory');
    }

    const entries = fs.readdirSync(directory);

    // Detect JAR file and server type
    let jarFile = null;
    let type = 'unknown';
    let version = null;

    for (const entry of entries) {
        if (!entry.endsWith('.jar')) continue;
        for (const pattern of JAR_PATTERNS) {
            const match = entry.match(pattern.regex);
            if (match) {
                jarFile = entry;
                type = pattern.type;
                version = match[1] || null;
                break;
            }
        }
        if (jarFile) break;
    }

    // Fallback: pick the first .jar if none matched
    if (!jarFile) {
        const jars = entries.filter(e => e.endsWith('.jar'));
        if (jars.length > 0) {
            jarFile = jars[0];
            type = 'custom';
        }
    }

    // For proxy types, read proxy config instead of server.properties
    if (isProxyType(type)) {
        return detectProxyConfig(directory, type, jarFile, version, entries);
    }

    // Read server.properties
    let port = 25565;
    let motd = '';
    let maxPlayers = 20;
    let gamemode = 'survival';
    let difficulty = 'easy';
    const propsPath = path.join(directory, 'server.properties');
    const hasProperties = fs.existsSync(propsPath);

    if (hasProperties) {
        try {
            const content = fs.readFileSync(propsPath, 'utf-8');
            const props = {};
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eq = trimmed.indexOf('=');
                if (eq > 0) {
                    props[trimmed.substring(0, eq).trim()] = trimmed.substring(eq + 1).trim();
                }
            }
            port = parseInt(props['server-port']) || 25565;
            motd = props['motd'] || '';
            maxPlayers = parseInt(props['max-players']) || 20;
            gamemode = props['gamemode'] || 'survival';
            difficulty = props['difficulty'] || 'easy';
        } catch (e) {}
    }

    // Check EULA
    const hasEula = fs.existsSync(path.join(directory, 'eula.txt'));

    return {
        type,
        jarFile,
        version,
        port,
        motd,
        maxPlayers,
        gamemode,
        difficulty,
        hasEula,
        hasProperties,
        directory,
        isProxy: false
    };
}

function detectProxyConfig(directory, type, jarFile, version, entries) {
    let port = 25577;

    if (type === 'velocity') {
        // Read velocity.toml for bind address
        const tomlPath = path.join(directory, 'velocity.toml');
        if (fs.existsSync(tomlPath)) {
            try {
                const content = fs.readFileSync(tomlPath, 'utf-8');
                const bindMatch = content.match(/^bind\s*=\s*"[^"]*:(\d+)"/m);
                if (bindMatch) port = parseInt(bindMatch[1]);
            } catch (e) {}
        }
    } else if (type === 'bungeecord') {
        // Read config.yml for host address
        const ymlPath = path.join(directory, 'config.yml');
        if (fs.existsSync(ymlPath)) {
            try {
                const content = fs.readFileSync(ymlPath, 'utf-8');
                const hostMatch = content.match(/host:\s*[\d.]*:(\d+)/);
                if (hostMatch) port = parseInt(hostMatch[1]);
            } catch (e) {}
        }
    }

    return {
        type,
        jarFile,
        version,
        port,
        motd: '',
        maxPlayers: 0,
        gamemode: null,
        difficulty: null,
        hasEula: false,
        hasProperties: false,
        directory,
        isProxy: true
    };
}

module.exports = { detectServerConfig, isProxyType, PROXY_TYPES };
