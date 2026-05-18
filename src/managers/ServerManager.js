const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');
const ServerInstance = require('./ServerInstance');
const { detectServerConfig, isProxyType } = require('../services/serverDetector');

const REGISTRY_PATH = path.join(config.dataDir, 'servers.json');
const TEMPLATES_PATH = path.join(config.dataDir, 'templates.json');

// Fields a client is allowed to set on an existing server via PATCH.
// Anything not in this list is silently dropped to prevent mass-assignment
// of internal fields like `directory`, `crashHistory`, or `id`.
const UPDATABLE_FIELDS = new Set([
    'name',
    'port',
    'memory',
    'jvmArgs',
    'maxPlayers',
    'autoStart',
    'autoRestart',
    'maxAutoRestarts',
    'crashCooldown',
    'motd',
    'gamemode',
    'difficulty',
    'resourceLimits',
    'docker'
]);

class ServerManager extends EventEmitter {
    constructor() {
        super();
        this.servers = new Map();
        this.networkManager = null;
    }

    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
    }

    async loadServers() {
        if (!fs.existsSync(REGISTRY_PATH)) {
            fs.writeFileSync(REGISTRY_PATH, '[]');
            return;
        }

        try {
            const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
            for (const serverConfig of data) {
                const instance = new ServerInstance(serverConfig);
                this._attachListeners(instance);
                this.servers.set(serverConfig.id, instance);
                logger.info(`Loaded server: ${serverConfig.name} (${serverConfig.id})`);
            }
            logger.info(`Loaded ${this.servers.size} server(s) from registry`);
        } catch (err) {
            logger.error(`Failed to load server registry: ${err.message}`);
        }
    }

    async createServer(options) {
        if (this.servers.size >= config.maxServers) {
            throw new Error(`Maximum server limit reached (${config.maxServers})`);
        }

        // Auto-assign port if not provided, validate if provided
        if (options.port) {
            if (!this.isPortAvailable(options.port)) {
                throw new Error(`Port ${options.port} is already in use by another server`);
            }
        } else {
            options.port = this.getNextAvailablePort();
        }

        const id = uuidv4();
        const dirName = options.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const directory = path.join(config.serversRoot, `${dirName}-${id.slice(0, 8)}`);

        // Archive upload path — the zip was already extracted into a staging
        // directory. Move it into place as the server's directory.
        if (options.sourceDirectory && fs.existsSync(options.sourceDirectory)) {
            // Must not already exist — rename would fail and cpSync would merge
            if (fs.existsSync(directory)) {
                fs.rmSync(directory, { recursive: true, force: true });
            }
            try {
                fs.renameSync(options.sourceDirectory, directory);
            } catch (e) {
                // Cross-device or in-use — fall back to copy + delete
                fs.cpSync(options.sourceDirectory, directory, { recursive: true });
                try { fs.rmSync(options.sourceDirectory, { recursive: true, force: true }); } catch (_) {}
            }
            // Detect the jar name from the copied contents (trust caller hint first)
            if (!options.jarFile) {
                try {
                    const entries = fs.readdirSync(directory);
                    const jar = entries.find(f => f.toLowerCase().endsWith('.jar'));
                    if (jar) options.jarFile = jar;
                } catch (_) {}
            }
        } else {
            // Create server directory
            fs.mkdirSync(directory, { recursive: true });

            // Copy JAR to server directory
            if (options.jarPath && fs.existsSync(options.jarPath)) {
                const jarName = path.basename(options.jarPath);
                fs.copyFileSync(options.jarPath, path.join(directory, jarName));
                options.jarFile = jarName;
            }
        }

        // Proxy servers don't use eula.txt or server.properties
        if (!isProxyType(options.type)) {
            // Write EULA (safe to overwrite — user is going through our flow)
            fs.writeFileSync(path.join(directory, 'eula.txt'), 'eula=true\n');

            // Build the properties we want to set from the wizard options
            const overrides = {};
            if (options.port) overrides['server-port'] = String(options.port);
            if (options.motd) overrides['motd'] = options.motd;
            if (options.gamemode) overrides['gamemode'] = options.gamemode;
            if (options.maxPlayers) overrides['max-players'] = String(options.maxPlayers);
            if (options.difficulty) overrides['difficulty'] = options.difficulty;

            const propsPath = path.join(directory, 'server.properties');

            if (options.sourceDirectory && fs.existsSync(propsPath)) {
                // Merge user-supplied overrides into the file the zip brought with it.
                // Preserves world seed, view-distance, plugins configs, etc.
                const existing = fs.readFileSync(propsPath, 'utf-8').split(/\r?\n/);
                const seen = new Set();
                const merged = existing.map(line => {
                    if (!line || line.trim().startsWith('#')) return line;
                    const eq = line.indexOf('=');
                    if (eq <= 0) return line;
                    const key = line.substring(0, eq).trim();
                    seen.add(key);
                    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                        return `${key}=${overrides[key]}`;
                    }
                    return line;
                });
                // Append any override keys that weren't present
                for (const [key, value] of Object.entries(overrides)) {
                    if (!seen.has(key)) merged.push(`${key}=${value}`);
                }
                fs.writeFileSync(propsPath, merged.join('\n').replace(/\n+$/,'') + '\n');
            } else if (Object.keys(overrides).length > 0) {
                // Fresh server — write from scratch
                const lines = Object.entries(overrides).map(([k, v]) => `${k}=${v}`);
                fs.writeFileSync(propsPath, lines.join('\n') + '\n');
            }
        }

        const serverConfig = {
            id,
            name: options.name,
            type: options.type || 'vanilla',
            version: options.version || 'unknown',
            jarFile: options.jarFile || 'server.jar',
            directory,
            port: options.port,
            memory: options.memory || { min: '1G', max: '2G' },
            javaPath: options.javaPath || config.defaultJavaPath,
            jvmArgs: options.jvmArgs || [],
            maxPlayers: options.maxPlayers || 20,
            autoStart: options.autoStart || false,
            autoRestart: options.autoRestart || false,
            maxAutoRestarts: options.maxAutoRestarts ?? 3,
            createdAt: new Date().toISOString(),
            lastStarted: null
        };

        const instance = new ServerInstance(serverConfig);
        this._attachListeners(instance);
        this.servers.set(id, instance);
        await this.saveRegistry();

        logger.info(`Created server: ${serverConfig.name} (${id})`);
        return instance;
    }

    async deleteServer(id) {
        const instance = this.servers.get(id);
        if (!instance) throw new Error('Server not found');

        // Check network membership
        if (this.networkManager) {
            const network = this.networkManager.getNetworkForServer(id);
            if (network) {
                if (network.proxyId === id) {
                    throw new Error(`Cannot delete proxy server while it belongs to network "${network.name}". Delete the network first.`);
                }
                // Auto-unlink backend from network
                await this.networkManager.removeBackend(network.id, id);
            }
        }

        // Stop if running
        if (instance.process) {
            await instance.stop();
        }

        // Remove directory
        const dir = instance.config.directory;
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        this.servers.delete(id);
        await this.saveRegistry();
        logger.info(`Deleted server: ${instance.name} (${id})`);
    }

    async importServer(directory, options = {}) {
        if (this.servers.size >= config.maxServers) {
            throw new Error(`Maximum server limit reached (${config.maxServers})`);
        }

        // Validate directory
        if (!fs.existsSync(directory)) {
            throw new Error('Directory does not exist');
        }

        // Check if directory is already managed
        for (const [, instance] of this.servers) {
            if (path.resolve(instance.config.directory) === path.resolve(directory)) {
                throw new Error('This directory is already managed by FortunaPanel');
            }
        }

        // Detect server configuration
        const detected = detectServerConfig(directory);
        if (!detected.jarFile) {
            throw new Error('No server JAR file found in the directory');
        }

        // Check port availability
        const port = options.port || detected.port;
        if (!this.isPortAvailable(port)) {
            throw new Error(`Port ${port} is already in use by another server. Please specify a different port.`);
        }

        const id = require('uuid').v4();
        const serverConfig = {
            id,
            name: options.name || path.basename(directory),
            type: detected.type,
            version: detected.version || options.version || 'unknown',
            jarFile: detected.jarFile,
            directory: path.resolve(directory),
            port,
            memory: options.memory || { min: '1G', max: '2G' },
            javaPath: options.javaPath || config.defaultJavaPath,
            jvmArgs: options.jvmArgs || [],
            maxPlayers: detected.maxPlayers,
            autoStart: false,
            autoRestart: false,
            maxAutoRestarts: 3,
            createdAt: new Date().toISOString(),
            lastStarted: null,
            imported: true,
            importedAt: new Date().toISOString()
        };

        const instance = new ServerInstance(serverConfig);
        this._attachListeners(instance);
        this.servers.set(id, instance);
        await this.saveRegistry();

        logger.info(`Imported server: ${serverConfig.name} from ${directory} (${id})`);
        return instance;
    }

    async cloneServer(sourceId, newName, options = {}) {
        const source = this.servers.get(sourceId);
        if (!source) throw new Error('Source server not found');

        if (this.servers.size >= config.maxServers) {
            throw new Error(`Maximum server limit reached (${config.maxServers})`);
        }

        const { copyWorld = true, copyPlugins = true } = options;

        const id = uuidv4();
        const name = newName || `Copy of ${source.name}`;
        const dirName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const directory = path.join(config.serversRoot, `${dirName}-${id.slice(0, 8)}`);
        const port = this.getNextAvailablePort();

        // Copy files recursively
        logger.info(`Cloning server ${source.name} to ${directory}...`);
        fs.cpSync(source.config.directory, directory, { recursive: true });

        // Conditionally remove world data
        if (!copyWorld) {
            const worldDirs = ['world', 'world_nether', 'world_the_end'];
            for (const dir of worldDirs) {
                const worldPath = path.join(directory, dir);
                if (fs.existsSync(worldPath)) {
                    fs.rmSync(worldPath, { recursive: true, force: true });
                    logger.info(`Removed world directory: ${dir}`);
                }
            }
        }

        // Conditionally remove plugins/mods
        if (!copyPlugins) {
            const pluginDirs = ['plugins', 'mods'];
            for (const dir of pluginDirs) {
                const pluginPath = path.join(directory, dir);
                if (fs.existsSync(pluginPath)) {
                    fs.rmSync(pluginPath, { recursive: true, force: true });
                    logger.info(`Removed directory: ${dir}`);
                }
            }
        }

        // Update server.properties with new port
        const propsPath = path.join(directory, 'server.properties');
        if (fs.existsSync(propsPath)) {
            let content = fs.readFileSync(propsPath, 'utf-8');
            content = content.replace(/^server-port=\d+/m, `server-port=${port}`);
            fs.writeFileSync(propsPath, content);
        }

        const serverConfig = {
            ...JSON.parse(JSON.stringify(source.config)),
            id,
            name,
            directory,
            port,
            autoStart: false,
            createdAt: new Date().toISOString(),
            lastStarted: null,
            clonedFrom: sourceId,
            clonedAt: new Date().toISOString()
        };

        // Clear crash history for clone
        delete serverConfig.crashHistory;

        const instance = new ServerInstance(serverConfig);
        this._attachListeners(instance);
        this.servers.set(id, instance);
        await this.saveRegistry();

        logger.info(`Cloned server: ${name} (${id}) from ${source.name}`);
        return instance;
    }

    getServer(id) {
        return this.servers.get(id);
    }

    getAllServers() {
        return Array.from(this.servers.values()).map(s => ({
            ...s.getStatus(),
            directory: s.config.directory,
            jarFile: s.config.jarFile,
            jvmArgs: s.config.jvmArgs,
            autoStart: s.config.autoStart,
            createdAt: s.config.createdAt,
            lastStarted: s.config.lastStarted,
            suspended: s.config.suspended || false,
            suspendedAt: s.config.suspendedAt || null,
            resourceLimits: s.config.resourceLimits || null,
            startupVariables: s.config.startupVariables || null
        }));
    }

    // Port allocation methods
    getUsedPorts() {
        const ports = [];
        for (const [id, instance] of this.servers) {
            if (instance.config.port) {
                ports.push({ port: instance.config.port, serverId: id, serverName: instance.name });
            }
        }
        return ports.sort((a, b) => a.port - b.port);
    }

    isPortAvailable(port, excludeServerId = null) {
        for (const [id, instance] of this.servers) {
            if (excludeServerId && id === excludeServerId) continue;
            if (instance.config.port === port) return false;
        }
        return true;
    }

    getNextAvailablePort(startPort = 25565) {
        const usedPorts = new Set(this.getUsedPorts().map(p => p.port));
        let port = startPort;
        while (usedPorts.has(port)) {
            port++;
        }
        return port;
    }

    async startServer(id) {
        const instance = this.servers.get(id);
        if (!instance) throw new Error('Server not found');

        const result = instance.start(this._dockerManager || null);
        if (result) {
            instance.config.lastStarted = new Date().toISOString();
            await this.saveRegistry();
        }
        return result;
    }

    setDockerManager(dockerManager) {
        this._dockerManager = dockerManager;
    }

    async stopServer(id) {
        const instance = this.servers.get(id);
        if (!instance) throw new Error('Server not found');
        return instance.stop();
    }

    async restartServer(id) {
        const instance = this.servers.get(id);
        if (!instance) throw new Error('Server not found');
        return instance.restart();
    }

    async updateServer(id, updates) {
        const instance = this.servers.get(id);
        if (!instance) throw new Error('Server not found');

        // Allowlist what callers (HTTP API) can change. Internal fields
        // like `directory`, `id`, `javaPath`, `jarFile`, `crashHistory`
        // are out of band and must not be settable from request bodies.
        const safe = {};
        if (updates && typeof updates === 'object') {
            for (const key of Object.keys(updates)) {
                if (UPDATABLE_FIELDS.has(key)) safe[key] = updates[key];
            }
        }

        instance.updateConfig(safe);
        await this.saveRegistry();
        return instance;
    }

    async saveRegistry() {
        const data = Array.from(this.servers.values()).map(s => s.config);
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
    }

    async shutdownAll() {
        logger.info('Shutting down all servers...');
        const running = Array.from(this.servers.values()).filter(s => s.process);
        await Promise.all(running.map(s => s.stop()));
        logger.info('All servers stopped');
    }

    async autoStartServers() {
        for (const [id, instance] of this.servers) {
            if (instance.config.autoStart && !instance.config.suspended) {
                logger.info(`Auto-starting server: ${instance.name}`);
                await this.startServer(id);
            }
        }
    }

    _attachListeners(instance) {
        instance.on('console', (data) => this.emit('console', data));
        instance.on('status', (data) => this.emit('status', data));
        instance.on('player-join', (data) => this.emit('player-join', data));
        instance.on('player-leave', (data) => this.emit('player-leave', data));
        instance.on('error', (data) => this.emit('server-error', { serverId: instance.id, ...data }));
        instance.on('crash', (data) => this.emit('crash', data));
        instance.on('max-crashes', (data) => this.emit('max-crashes', data));
    }

    // ==================== Template System ====================

    _loadTemplates() {
        if (!fs.existsSync(TEMPLATES_PATH)) return [];
        try {
            return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf-8'));
        } catch {
            return [];
        }
    }

    _saveTemplates(templates) {
        fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
    }

    saveAsTemplate(serverId, templateName) {
        const source = this.servers.get(serverId);
        if (!source) throw new Error('Server not found');

        const templates = this._loadTemplates();
        const template = {
            id: uuidv4(),
            name: templateName,
            createdAt: new Date().toISOString(),
            sourceServer: source.name,
            config: {
                type: source.config.type,
                version: source.config.version,
                jarFile: source.config.jarFile,
                memory: source.config.memory,
                jvmArgs: source.config.jvmArgs || [],
                maxPlayers: source.config.maxPlayers || 20,
                gamemode: source.config.gamemode || 'survival',
                difficulty: source.config.difficulty || 'normal',
                motd: source.config.motd || ''
            }
        };

        templates.push(template);
        this._saveTemplates(templates);
        logger.info(`Saved template "${templateName}" from server ${source.name}`);
        return template;
    }

    getTemplates() {
        return this._loadTemplates();
    }

    getTemplate(templateId) {
        return this._loadTemplates().find(t => t.id === templateId);
    }

    deleteTemplate(templateId) {
        const templates = this._loadTemplates();
        const idx = templates.findIndex(t => t.id === templateId);
        if (idx === -1) throw new Error('Template not found');
        const removed = templates.splice(idx, 1)[0];
        this._saveTemplates(templates);
        logger.info(`Deleted template "${removed.name}"`);
        return removed;
    }

    async createFromTemplate(templateId, { name, port, memory }) {
        const template = this.getTemplate(templateId);
        if (!template) throw new Error('Template not found');

        if (this.servers.size >= config.maxServers) {
            throw new Error(`Maximum server limit reached (${config.maxServers})`);
        }

        const id = uuidv4();
        const serverName = name || `${template.name} Server`;
        const dirName = serverName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const directory = path.join(config.serversRoot, `${dirName}-${id.slice(0, 8)}`);
        const serverPort = port || this.getNextAvailablePort();

        // Create directory
        fs.mkdirSync(directory, { recursive: true });

        // Copy the JAR from an existing server with same type/version, or flag for download
        let jarFile = template.config.jarFile;
        let jarCopied = false;

        // Try to find existing JAR to copy
        for (const s of this.servers.values()) {
            if (s.config.type === template.config.type && s.config.version === template.config.version) {
                const srcJar = path.join(s.config.directory, s.config.jarFile);
                if (fs.existsSync(srcJar)) {
                    fs.cpSync(srcJar, path.join(directory, jarFile));
                    jarCopied = true;
                    break;
                }
            }
        }

        const serverConfig = {
            id,
            name: serverName,
            type: template.config.type,
            version: template.config.version,
            directory,
            jarFile,
            port: serverPort,
            memory: memory || template.config.memory,
            jvmArgs: template.config.jvmArgs || [],
            maxPlayers: template.config.maxPlayers,
            gamemode: template.config.gamemode,
            difficulty: template.config.difficulty,
            motd: template.config.motd,
            autoStart: false,
            createdAt: new Date().toISOString(),
            fromTemplate: templateId,
            fromTemplateName: template.name,
            jarCopied
        };

        // Accept EULA for new servers
        fs.writeFileSync(path.join(directory, 'eula.txt'), 'eula=true\n');

        const instance = new ServerInstance(serverConfig);
        this._attachListeners(instance);
        this.servers.set(id, instance);
        await this.saveRegistry();

        logger.info(`Created server "${serverName}" from template "${template.name}"`);
        return instance;
    }
}

module.exports = ServerManager;
