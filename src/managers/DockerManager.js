const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');

// Default Docker image for Minecraft servers
const DEFAULT_IMAGE = 'eclipse-temurin:21-jre';

// Image-name validator shared by pull and run. Rejects argument injection
// (leading dash) and any character that is not part of a normal Docker tag.
const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$/;
function isValidImage(image) {
    return typeof image === 'string' && !image.startsWith('-') && IMAGE_RE.test(image);
}

// Env keys must look like environment variables. Values must not contain
// control characters or newlines (which would split additional CLI args).
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isValidEnvKey(k) { return typeof k === 'string' && ENV_KEY_RE.test(k); }
function isValidEnvValue(v) {
    if (typeof v !== 'string') return false;
    return !/[\r\n\x00]/.test(v);
}

// Docker flags that grant host access we never want to expose. Match the
// flag head only (the part before "=" / a space) so `--volume=/etc:/host`
// and `--volume /etc:/host` are both caught.
const BLOCKED_FLAG_HEADS = new Set([
    '--privileged',
    '--pid',
    '--ipc',
    '--uts',
    '--userns',
    '--cgroup-parent',
    '--cap-add',
    '--security-opt',
    '--device',
    '--device-cgroup-rule',
    '--mount',
    '--volume',
    '-v',
    '--network',
    '--net',
    '--user',
    '-u',
    '--gpus',
    '--runtime',
    '--restart',
    '--add-host',
    '--sysctl',
    '--tmpfs'
]);
function flagHead(flag) {
    if (typeof flag !== 'string') return '';
    const eq = flag.indexOf('=');
    const head = (eq >= 0 ? flag.slice(0, eq) : flag.split(/\s+/)[0]).toLowerCase();
    return head;
}

class DockerManager extends EventEmitter {
    constructor(serverManager) {
        super();
        this.serverManager = serverManager;
        this._available = null; // null = not checked yet
        this._availableCheckedAt = 0;
    }

    /**
     * Check if Docker is installed and accessible.
     * Cached for 60 seconds to avoid repeated process spawns.
     */
    async checkAvailable() {
        const CACHE_TTL = 60000; // 60s
        if (this._available !== null && (Date.now() - this._availableCheckedAt) < CACHE_TTL) {
            return this._available;
        }
        try {
            execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
                timeout: 5000,
                encoding: 'utf-8',
                windowsHide: true
            });
            this._available = true;
        } catch (_) {
            this._available = false;
        }
        this._availableCheckedAt = Date.now();
        return this._available;
    }

    /**
     * Get Docker system info.
     */
    async getInfo() {
        const available = await this.checkAvailable();
        if (!available) return { available: false };

        try {
            const version = execFileSync('docker', ['version', '--format', '{{json .}}'], {
                timeout: 5000, encoding: 'utf-8', windowsHide: true
            }).trim();

            const info = execFileSync('docker', ['info', '--format', '{{json .}}'], {
                timeout: 10000, encoding: 'utf-8', windowsHide: true
            }).trim();

            return {
                available: true,
                version: JSON.parse(version),
                info: (() => {
                    try {
                        const parsed = JSON.parse(info);
                        return {
                            containers: parsed.Containers,
                            containersRunning: parsed.ContainersRunning,
                            images: parsed.Images,
                            memoryLimit: parsed.MemTotal,
                            cpus: parsed.NCPU,
                            os: parsed.OperatingSystem
                        };
                    } catch { return {}; }
                })()
            };
        } catch (e) {
            return { available: true, error: e.message };
        }
    }

    /**
     * Get container name for a server.
     */
    containerName(serverId) {
        return `fp-${serverId.slice(0, 12)}`;
    }

    /**
     * Start a server in a Docker container.
     * Returns a child_process-like object with stdin/stdout for console.
     */
    startContainer(serverInstance) {
        const cfg = serverInstance.config;
        const docker = cfg.docker || {};
        const name = this.containerName(serverInstance.id);
        const image = docker.image || DEFAULT_IMAGE;
        const port = cfg.port || 25565;

        // Validate image up-front to prevent CLI-flag injection via image name.
        if (!isValidImage(image)) {
            throw new Error(`Invalid Docker image name: ${image}`);
        }

        const args = [
            'run',
            '--rm',
            '--name', name,
            '-i', // Interactive so we can pipe stdin
            // Port mapping
            '-p', `${port}:25565/tcp`,
            '-p', `${port}:25565/udp`,
            // Mount server directory
            '-v', `${path.resolve(cfg.directory)}:/server`,
            '-w', '/server',
        ];

        // Memory limits
        if (cfg.memory?.max) {
            const memBytes = this._parseMemory(cfg.memory.max);
            if (memBytes) args.push('-m', String(memBytes));
        }

        // CPU limits
        if (docker.cpuLimit) {
            args.push('--cpus', String(docker.cpuLimit));
        }

        // Extra ports (RCON, query, etc.)
        if (docker.extraPorts) {
            for (const p of docker.extraPorts) {
                args.push('-p', `${p}:${p}`);
            }
        }

        // Environment variables — validate each pair to prevent argument
        // injection via a value that contains a newline or shell-control
        // characters, and to ensure the key looks like a real env name.
        if (docker.env && typeof docker.env === 'object') {
            for (const [key, val] of Object.entries(docker.env)) {
                if (!isValidEnvKey(key)) {
                    logger.warn(`Blocked invalid Docker env key: ${key}`);
                    continue;
                }
                if (!isValidEnvValue(val)) {
                    logger.warn(`Blocked invalid Docker env value for ${key}`);
                    continue;
                }
                args.push('-e', `${key}=${val}`);
            }
        }

        // Custom Docker flags — strict blocklist on the *flag head* so
        // `--volume=/etc:/host-etc`, `--mount`, `--user=root`, etc. can't
        // be smuggled past the original startsWith match.
        if (docker.extraFlags && Array.isArray(docker.extraFlags)) {
            for (const flag of docker.extraFlags) {
                if (typeof flag !== 'string') continue;
                if (/[\r\n\x00]/.test(flag)) {
                    logger.warn(`Blocked Docker flag with control chars`);
                    continue;
                }
                if (BLOCKED_FLAG_HEADS.has(flagHead(flag))) {
                    logger.warn(`Blocked dangerous Docker flag: ${flag}`);
                    continue;
                }
                args.push(flag);
            }
        }

        // Image + Java command
        args.push(image);
        args.push('java',
            `-Xms${cfg.memory?.min || '512M'}`,
            `-Xmx${cfg.memory?.max || '1G'}`,
            ...(cfg.jvmArgs || []),
            '-jar', cfg.jarFile,
            'nogui'
        );

        logger.info(`Starting Docker container ${name} for server ${serverInstance.name}`);
        logger.info(`Docker args: docker ${args.join(' ')}`);

        const proc = spawn('docker', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        return proc;
    }

    /**
     * Stop a Docker container gracefully.
     */
    async stopContainer(serverId, timeout = 30) {
        const name = this.containerName(serverId);
        return new Promise((resolve) => {
            execFile('docker', ['stop', '-t', String(timeout), name], {
                timeout: (timeout + 10) * 1000,
                windowsHide: true
            }, (err) => {
                if (err) {
                    logger.warn(`Docker stop failed for ${name}: ${err.message}`);
                }
                resolve();
            });
        });
    }

    /**
     * Force kill a Docker container.
     */
    killContainer(serverId) {
        const name = this.containerName(serverId);
        try {
            execFileSync('docker', ['kill', name], {
                timeout: 10000, windowsHide: true
            });
        } catch (_) {}
    }

    /**
     * Get container stats (CPU, memory).
     */
    async getContainerStats(serverId) {
        const name = this.containerName(serverId);
        try {
            const output = execFileSync('docker', [
                'stats', '--no-stream', '--format', '{{json .}}', name
            ], { timeout: 10000, encoding: 'utf-8', windowsHide: true }).trim();

            const stats = JSON.parse(output);
            return {
                cpu: parseFloat(stats.CPUPerc) || 0,
                memoryUsage: stats.MemUsage || '0B / 0B',
                memoryPercent: parseFloat(stats.MemPerc) || 0,
                netIO: stats.NetIO || '0B / 0B',
                blockIO: stats.BlockIO || '0B / 0B',
                pids: parseInt(stats.PIDs) || 0
            };
        } catch (_) {
            return null;
        }
    }

    /**
     * Check if a container is running.
     */
    isContainerRunning(serverId) {
        const name = this.containerName(serverId);
        try {
            const state = execFileSync('docker', [
                'inspect', '--format', '{{.State.Running}}', name
            ], { timeout: 5000, encoding: 'utf-8', windowsHide: true }).trim();
            return state === 'true';
        } catch (_) {
            return false;
        }
    }

    /**
     * List all FortunaPanel containers.
     */
    listContainers() {
        try {
            const output = execFileSync('docker', [
                'ps', '-a', '--filter', 'name=fp-',
                '--format', '{{json .}}'
            ], { timeout: 10000, encoding: 'utf-8', windowsHide: true }).trim();

            if (!output) return [];
            return output.split('\n').map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    /**
     * Pull a Docker image.
     */
    async pullImage(image) {
        // Validate image name to prevent argument injection
        if (!isValidImage(image)) {
            throw new Error('Invalid Docker image name');
        }
        return new Promise((resolve, reject) => {
            logger.info(`Pulling Docker image: ${image}`);
            execFile('docker', ['pull', image], {
                timeout: 300000, // 5 min
                windowsHide: true
            }, (err, stdout) => {
                if (err) {
                    logger.error(`Docker pull failed: ${err.message}`);
                    reject(new Error(`Failed to pull image: ${err.message}`));
                } else {
                    logger.info(`Docker image pulled: ${image}`);
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * List available images.
     */
    listImages() {
        try {
            const output = execFileSync('docker', [
                'images', '--format', '{{json .}}'
            ], { timeout: 10000, encoding: 'utf-8', windowsHide: true }).trim();

            if (!output) return [];
            return output.split('\n').map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    /**
     * Parse memory string (1G, 512M) to bytes.
     */
    _parseMemory(memStr) {
        if (!memStr) return null;
        const match = String(memStr).match(/^(\d+(?:\.\d+)?)\s*(G|M|K)?$/i);
        if (!match) return null;
        const val = parseFloat(match[1]);
        const unit = (match[2] || 'M').toUpperCase();
        switch (unit) {
            case 'G': return Math.round(val * 1024 * 1024 * 1024);
            case 'M': return Math.round(val * 1024 * 1024);
            case 'K': return Math.round(val * 1024);
            default: return Math.round(val);
        }
    }
}

module.exports = DockerManager;
