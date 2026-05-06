const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');

// Default Docker image for Minecraft servers
const DEFAULT_IMAGE = 'eclipse-temurin:21-jre';

class DockerManager extends EventEmitter {
    constructor(serverManager) {
        super();
        this.serverManager = serverManager;
        this._available = null; // null = not checked yet
    }

    /**
     * Check if Docker is installed and accessible.
     */
    async checkAvailable() {
        if (this._available !== null) return this._available;
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

        // Environment variables
        if (docker.env) {
            for (const [key, val] of Object.entries(docker.env)) {
                args.push('-e', `${key}=${val}`);
            }
        }

        // Custom Docker flags
        if (docker.extraFlags && Array.isArray(docker.extraFlags)) {
            args.push(...docker.extraFlags);
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
