const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const logger = require('../utils/logger');
const { killProcessTree, sanitizeConsoleLine } = require('../utils/processUtils');

const PATTERNS = {
    logLine: /^\[(\d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR)\]:\s+(.*)$/,
    playerJoin: /(\w+)\[\/[\d.:]+\] logged in/,
    playerLeave: /^(\w+) left the game$/,
    serverDone: /Done \([\d.]+s\)!/,
    playerList: /There are (\d+) of a max of (\d+) players online/,
    eulaPrompt: /You need to agree to the EULA/,
};

const PROXY_PATTERNS = {
    velocityDone: /Done \([\d.,]+s\)!/,
    bungeeDone: /Listening on \/[\d.:]+/,
    velocityPlayerJoin: /\[connected player\] (\w+)/,
    velocityPlayerLeave: /\[disconnected\] (\w+)/,
    bungeePlayerJoin: /(\w+) has connected$/,
    bungeePlayerLeave: /(\w+) has disconnected$/,
    velocityLog: /^\[(\d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR)\]\s+(.*)$/,
};

const MAX_CONSOLE_BUFFER = 500;

class ServerInstance extends EventEmitter {
    constructor(serverConfig) {
        super();
        this.config = serverConfig;
        this.id = serverConfig.id;
        this.name = serverConfig.name;
        this.process = null;
        this.status = 'stopped';
        this.consoleBuffer = [];
        this.players = new Set();
        this.startedAt = null;
        this.pid = null;
        this._stdoutBuffer = '';
        this._stderrBuffer = '';

        // Crash detection
        this.gracefulStop = false;
        this.crashCount = 0;
        this.lastCrashTime = null;
        this._crashCooldownTimer = null;
        this.crashHistory = serverConfig.crashHistory || [];

        // TPS tracking
        this.lastTps = null;
    }

    start(dockerManager) {
        // Guard against concurrent calls: check + set status before any async
        // work so a second caller sees 'starting' and bails.
        if (this.process || this.status === 'starting' || this.status === 'running') {
            logger.warn(`Server ${this.name} is already ${this.status}`);
            return false;
        }
        if (this.status === 'stopping') {
            logger.warn(`Server ${this.name} is stopping, cannot start`);
            return false;
        }

        this._setStatus('starting');
        this._dockerManager = null;

        // Docker mode: start inside a container
        if (this.config.docker?.enabled && dockerManager) {
            this._dockerManager = dockerManager;
            try {
                this.process = dockerManager.startContainer(this);
            } catch (err) {
                logger.error(`Failed to start Docker container for ${this.name}: ${err.message}`);
                this._setStatus('stopped');
                this.emit('error', { message: `Docker start failed: ${err.message}` });
                return false;
            }
        } else {
            // Bare-metal mode: spawn Java directly
            const { javaPath, memory, jvmArgs, jarFile, directory } = this.config;
            const args = [
                `-Xms${memory.min}`,
                `-Xmx${memory.max}`,
                ...(jvmArgs || []),
                '-jar',
                jarFile,
                'nogui'
            ];

            logger.info(`Starting server ${this.name}: ${javaPath} ${args.join(' ')}`);

            try {
                this.process = spawn(javaPath || 'java', args, {
                    cwd: directory,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true
                });
            } catch (err) {
                logger.error(`Failed to spawn server ${this.name}: ${err.message}`);
                this._setStatus('stopped');
                this.emit('error', { message: `Failed to start: ${err.message}` });
                return false;
            }
        }

        this.pid = this.process.pid;
        const mode = this.config.docker?.enabled ? 'Docker' : 'PID';
        logger.info(`Server ${this.name} spawned with ${mode} ${this.pid}`);

        this.process.stdout.on('data', (chunk) => this._onStdout(chunk));
        this.process.stderr.on('data', (chunk) => this._onStderr(chunk));

        this.process.on('close', (code) => {
            logger.info(`Server ${this.name} exited with code ${code}`);
            const wasGraceful = this.gracefulStop;
            this.process = null;
            this.pid = null;
            this.players.clear();
            this._setStatus('stopped');
            this.startedAt = null;
            this.gracefulStop = false;

            // Crash detection: non-zero exit code and not a graceful stop
            if (!wasGraceful && code !== 0 && code !== null) {
                this._handleCrash(code);
            }
        });

        this.process.on('error', (err) => {
            logger.error(`Server ${this.name} process error: ${err.message}`);
            this.emit('error', { message: err.message });
        });

        return true;
    }

    async stop() {
        if (!this.process) {
            logger.warn(`Server ${this.name} is not running`);
            return false;
        }
        if (this.status === 'stopping') {
            logger.warn(`Server ${this.name} is already stopping`);
            return false;
        }

        this.gracefulStop = true;
        this._setStatus('stopping');
        this.sendCommand('stop');

        // Wait up to 30 seconds for graceful shutdown
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.process) {
                    logger.warn(`Server ${this.name} did not stop gracefully, force killing`);
                    this.kill();
                }
                resolve(true);
            }, 30000);

            this.once('status', (data) => {
                if (data.status === 'stopped') {
                    clearTimeout(timeout);
                    resolve(true);
                }
            });
        });
    }

    async restart() {
        const dm = this._dockerManager;
        this.gracefulStop = true;
        if (this.process) {
            await this.stop();
        }
        // Small delay between stop and start
        await new Promise(r => setTimeout(r, 1000));
        return this.start(dm);
    }

    sendCommand(command) {
        if (!this.process || !this.process.stdin.writable) {
            return false;
        }
        // Strip CR/LF/null bytes so a single call cannot inject extra commands.
        const sanitized = String(command).replace(/[\r\n\x00]+/g, ' ').trim();
        if (!sanitized) return false;
        this.process.stdin.write(sanitized + '\n');
        return true;
    }

    kill() {
        if (this.config.docker?.enabled && this._dockerManager) {
            this._dockerManager.killContainer(this.id);
        } else if (this.pid) {
            killProcessTree(this.pid);
        }
        if (this.process) {
            try { this.process.kill(); } catch (e) {}
        }
    }

    getStatus() {
        return {
            id: this.id,
            name: this.name,
            status: this.status,
            players: {
                online: this.players.size,
                list: Array.from(this.players),
                max: this.config.maxPlayers || 20
            },
            uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
            pid: this.pid,
            type: this.config.type,
            version: this.config.version,
            port: this.config.port,
            memory: this.config.memory,
            crashCount: this.crashCount,
            lastCrashTime: this.lastCrashTime,
            autoRestart: this.config.autoRestart || false,
            maxAutoRestarts: this.config.maxAutoRestarts ?? 3,
            crashCooldown: this.config.crashCooldown || 300000,
            crashHistory: this.crashHistory,
            lastTps: this.lastTps
        };
    }

    getConsoleHistory() {
        return [...this.consoleBuffer];
    }

    _onStdout(chunk) {
        this._stdoutBuffer += chunk.toString();
        // Cap stdout buffer between newlines so a malicious/runaway process
        // can't spike memory with a single unbounded line.
        if (this._stdoutBuffer.length > 65536) {
            this._stdoutBuffer = this._stdoutBuffer.slice(-65536);
        }
        const lines = this._stdoutBuffer.split('\n');
        this._stdoutBuffer = lines.pop();

        for (const raw of lines) {
            const line = sanitizeConsoleLine(raw.replace(/\r$/, '')).trim();
            if (line) this._handleConsoleLine(line);
        }
    }

    _onStderr(chunk) {
        this._stderrBuffer += chunk.toString();
        if (this._stderrBuffer.length > 65536) {
            this._stderrBuffer = this._stderrBuffer.slice(-65536);
        }
        const lines = this._stderrBuffer.split('\n');
        this._stderrBuffer = lines.pop();

        for (const raw of lines) {
            const line = sanitizeConsoleLine(raw.replace(/\r$/, '')).trim();
            if (line) this._handleConsoleLine(line, 'error');
        }
    }

    _handleConsoleLine(line, defaultLevel = 'info') {
        const isProxy = this.config.type === 'velocity' || this.config.type === 'bungeecord';

        // Parse log level
        let level = defaultLevel;
        const logMatch = line.match(isProxy ? (PROXY_PATTERNS.velocityLog || PATTERNS.logLine) : PATTERNS.logLine);
        if (logMatch) {
            level = logMatch[2].toLowerCase();
        }

        // Add to ring buffer
        const entry = { line, level, timestamp: Date.now() };
        this.consoleBuffer.push(entry);
        if (this.consoleBuffer.length > MAX_CONSOLE_BUFFER) {
            this.consoleBuffer.shift();
        }

        // Emit console event
        this.emit('console', { serverId: this.id, ...entry });

        // Check patterns
        const text = logMatch ? logMatch[3] : line;

        if (isProxy) {
            this._handleProxyPatterns(text);
        } else {
            this._handleServerPatterns(text);
        }
    }

    _handleServerPatterns(text) {
        // Server done starting
        if (PATTERNS.serverDone.test(text)) {
            this.startedAt = Date.now();
            this._setStatus('running');
        }

        // Player join
        const joinMatch = text.match(PATTERNS.playerJoin);
        if (joinMatch) {
            this.players.add(joinMatch[1]);
            this.emit('player-join', { serverId: this.id, player: joinMatch[1] });
        }

        // Player leave
        const leaveMatch = text.match(PATTERNS.playerLeave);
        if (leaveMatch) {
            this.players.delete(leaveMatch[1]);
            this.emit('player-leave', { serverId: this.id, player: leaveMatch[1] });
        }

        // Player list response
        const listMatch = text.match(PATTERNS.playerList);
        if (listMatch) {
            this.emit('player-count', {
                serverId: this.id,
                online: parseInt(listMatch[1]),
                max: parseInt(listMatch[2])
            });
        }

        // EULA prompt
        if (PATTERNS.eulaPrompt.test(text)) {
            this.emit('eula-required', { serverId: this.id });
        }

        // TPS tracking (Paper/Spigot format)
        const tpsMatch = text.match(/TPS from last .+ = .+, .+, \*?([\d.,]+)/);
        if (tpsMatch) {
            this.lastTps = parseFloat(tpsMatch[1].replace(',', '.'));
        }
    }

    _handleProxyPatterns(text) {
        const isVelocity = this.config.type === 'velocity';

        // Proxy done starting
        const donePattern = isVelocity ? PROXY_PATTERNS.velocityDone : PROXY_PATTERNS.bungeeDone;
        if (donePattern.test(text)) {
            this.startedAt = Date.now();
            this._setStatus('running');
        }

        // Player join
        const joinPattern = isVelocity ? PROXY_PATTERNS.velocityPlayerJoin : PROXY_PATTERNS.bungeePlayerJoin;
        const joinMatch = text.match(joinPattern);
        if (joinMatch) {
            this.players.add(joinMatch[1]);
            this.emit('player-join', { serverId: this.id, player: joinMatch[1] });
        }

        // Player leave
        const leavePattern = isVelocity ? PROXY_PATTERNS.velocityPlayerLeave : PROXY_PATTERNS.bungeePlayerLeave;
        const leaveMatch = text.match(leavePattern);
        if (leaveMatch) {
            this.players.delete(leaveMatch[1]);
            this.emit('player-leave', { serverId: this.id, player: leaveMatch[1] });
        }
    }

    _handleCrash(code) {
        this.crashCount++;
        this.lastCrashTime = Date.now();
        const maxAutoRestarts = this.config.maxAutoRestarts ?? 3;
        const willRestart = this.config.autoRestart && this.crashCount <= maxAutoRestarts;
        const delay = willRestart ? Math.min(5000 * this.crashCount, 30000) : null;

        // Persist crash to history (keep last 20)
        this.crashHistory.push({
            timestamp: Date.now(),
            exitCode: code,
            crashNumber: this.crashCount,
            restartAttempted: willRestart
        });
        if (this.crashHistory.length > 20) this.crashHistory.shift();
        this.config.crashHistory = this.crashHistory;

        logger.error(`Server ${this.name} crashed (exit code ${code}). Crash #${this.crashCount}`);
        this.emit('crash', {
            serverId: this.id,
            exitCode: code,
            crashCount: this.crashCount,
            willRestart,
            nextRestartIn: delay
        });

        // Reset crash count after cooldown period
        const cooldown = this.config.crashCooldown || 300000;
        clearTimeout(this._crashCooldownTimer);
        this._crashCooldownTimer = setTimeout(() => {
            if (this.crashCount > 0) {
                logger.info(`Server ${this.name}: crash counter reset after cooldown`);
                this.crashCount = 0;
            }
        }, cooldown);

        // Auto-restart with exponential backoff
        if (willRestart) {
            logger.info(`Server ${this.name}: auto-restarting in ${delay / 1000}s (attempt ${this.crashCount}/${maxAutoRestarts})`);
            setTimeout(() => {
                if (!this.process) {
                    this.start();
                }
            }, delay);
        } else if (this.config.autoRestart && this.crashCount > maxAutoRestarts) {
            logger.error(`Server ${this.name}: exceeded max auto-restarts (${maxAutoRestarts}). Giving up.`);
            this.emit('max-crashes', {
                serverId: this.id,
                crashCount: this.crashCount,
                maxAutoRestarts
            });
        }
    }

    _setStatus(status) {
        const prev = this.status;
        this.status = status;
        if (prev !== status) {
            this.emit('status', { serverId: this.id, status, previousStatus: prev });
        }
    }

    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        this.name = this.config.name;
    }
}

module.exports = ServerInstance;
