// FortunaPanel - Resource Limits Enforcement
// Monitors and enforces CPU, RAM, and Disk limits per server
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');
const { safePid } = require('../utils/validation');

class ResourceLimiter extends EventEmitter {
    constructor(serverManager) {
        super();
        this.serverManager = serverManager;
        this.interval = null;
        this.limits = new Map();       // serverId -> { cpuPercent, memoryMB, diskMB }
        this.usage = new Map();        // serverId -> { cpu, memory, disk }
        this.warnings = new Map();     // serverId -> { cpu: count, memory: count, disk: count }
        this.WARN_THRESHOLD = 3;       // warnings before action
        this.CHECK_INTERVAL = 10000;   // check every 10 seconds
    }

    // Set resource limits for a server
    setLimits(serverId, limits) {
        this.limits.set(serverId, {
            cpuPercent: limits.cpuPercent || 0,      // 0 = unlimited
            memoryMB: limits.memoryMB || 0,          // 0 = unlimited
            diskMB: limits.diskMB || 0               // 0 = unlimited
        });
        logger.info(`Resource limits set for ${serverId}: CPU=${limits.cpuPercent}%, RAM=${limits.memoryMB}MB, Disk=${limits.diskMB}MB`);
    }

    // Get limits for a server
    getLimits(serverId) {
        return this.limits.get(serverId) || { cpuPercent: 0, memoryMB: 0, diskMB: 0 };
    }

    // Get current usage for a server
    getUsage(serverId) {
        return this.usage.get(serverId) || { cpu: 0, memory: 0, disk: 0 };
    }

    // Start monitoring
    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this._check(), this.CHECK_INTERVAL);
        logger.info('Resource limiter started');
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async _check() {
        for (const [id, instance] of this.serverManager.servers) {
            if (!instance.process || instance.status !== 'running') continue;

            const limits = this.limits.get(id) || { cpuPercent: 0, memoryMB: 0, diskMB: 0 };
            const hasLimits = limits.cpuPercent > 0 || limits.memoryMB > 0 || limits.diskMB > 0;

            try {
                const usage = await this._getProcessUsage(instance.pid);
                const diskUsage = await this._getDiskUsage(instance.config.directory);

                const current = {
                    cpu: usage.cpu,
                    memory: usage.memory,
                    disk: diskUsage
                };

                this.usage.set(id, current);

                // Emit usage data for real-time UI (always, even if no limits set)
                this.emit('usage', { serverId: id, ...current, limits });

                if (!hasLimits) continue;

                // Check limits
                if (!this.warnings.has(id)) {
                    this.warnings.set(id, { cpu: 0, memory: 0, disk: 0 });
                }
                const warns = this.warnings.get(id);

                // CPU limit check
                if (limits.cpuPercent > 0 && current.cpu > limits.cpuPercent) {
                    warns.cpu++;
                    if (warns.cpu >= this.WARN_THRESHOLD) {
                        this.emit('limit-exceeded', {
                            serverId: id,
                            resource: 'cpu',
                            current: current.cpu,
                            limit: limits.cpuPercent
                        });
                        logger.warn(`Server ${instance.name}: CPU limit exceeded (${current.cpu.toFixed(1)}% > ${limits.cpuPercent}%)`);
                        warns.cpu = 0;
                    }
                } else {
                    warns.cpu = 0;
                }

                // Memory limit check
                if (limits.memoryMB > 0 && current.memory > limits.memoryMB) {
                    warns.memory++;
                    if (warns.memory >= this.WARN_THRESHOLD) {
                        this.emit('limit-exceeded', {
                            serverId: id,
                            resource: 'memory',
                            current: current.memory,
                            limit: limits.memoryMB
                        });
                        logger.warn(`Server ${instance.name}: Memory limit exceeded (${current.memory.toFixed(0)}MB > ${limits.memoryMB}MB)`);
                        warns.memory = 0;
                    }
                } else {
                    warns.memory = 0;
                }

                // Disk limit check
                if (limits.diskMB > 0 && current.disk > limits.diskMB) {
                    this.emit('limit-exceeded', {
                        serverId: id,
                        resource: 'disk',
                        current: current.disk,
                        limit: limits.diskMB
                    });
                    logger.warn(`Server ${instance.name}: Disk limit exceeded (${current.disk.toFixed(0)}MB > ${limits.diskMB}MB)`);
                }

            } catch (e) {
                // Process may have just stopped
            }
        }
    }

    // Get CPU and memory usage for a process
    async _getProcessUsage(pid) {
        // Validate PID before feeding it to any external process. Even though
        // `pid` comes from a spawned child_process.pid, defense-in-depth keeps
        // us safe if the value is ever sourced from elsewhere.
        let safe;
        try {
            safe = safePid(pid, 'pid');
        } catch (e) {
            return { cpu: 0, memory: 0 };
        }

        try {
            if (process.platform === 'win32') {
                // tasklist for memory (always available on Windows). execFileSync
                // does not spawn a shell, so no argument can be interpreted as
                // a shell metacharacter even if the pid validator were ever
                // weakened.
                let memoryMB = 0;
                try {
                    const memOutput = execFileSync(
                        'tasklist',
                        ['/FI', `PID eq ${safe}`, '/FO', 'CSV', '/NH'],
                        { timeout: 5000, encoding: 'utf-8', windowsHide: true }
                    ).trim();
                    const fields = memOutput.match(/"[^"]*"/g);
                    if (fields && fields.length >= 5) {
                        const memField = fields[fields.length - 1].replace(/"/g, '');
                        const memKB = parseInt(memField.replace(/\D/g, '')) || 0;
                        memoryMB = memKB / 1024;
                    }
                } catch (e) {}

                let cpu = 0;
                try {
                    const cpuOutput = execFileSync(
                        'powershell',
                        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${safe} -ErrorAction SilentlyContinue).CPU`],
                        { timeout: 5000, encoding: 'utf-8', windowsHide: true }
                    ).trim();
                    const cpuTime = parseFloat(cpuOutput) || 0;
                    const prevKey = `cpu_${safe}`;
                    const prevTime = this._cpuPrev?.get(prevKey);
                    const now = Date.now();
                    const prevTs = this._cpuPrevTs?.get(prevKey);

                    if (!this._cpuPrev) this._cpuPrev = new Map();
                    if (!this._cpuPrevTs) this._cpuPrevTs = new Map();

                    if (prevTime !== undefined && prevTs) {
                        const elapsedSec = (now - prevTs) / 1000;
                        if (elapsedSec > 0) {
                            cpu = ((cpuTime - prevTime) / elapsedSec) * 100;
                            cpu = Math.max(0, Math.min(cpu, os.cpus().length * 100));
                        }
                    }

                    this._cpuPrev.set(prevKey, cpuTime);
                    this._cpuPrevTs.set(prevKey, now);
                } catch (e) {}

                return { cpu, memory: memoryMB };
            } else {
                const output = execFileSync(
                    'ps',
                    ['-p', safe, '-o', '%cpu,rss', '--no-headers'],
                    { timeout: 5000, encoding: 'utf-8' }
                ).trim();
                const [cpuStr, rssStr] = output.split(/\s+/);
                return {
                    cpu: parseFloat(cpuStr) || 0,
                    memory: (parseInt(rssStr) || 0) / 1024
                };
            }
        } catch (e) {
            return { cpu: 0, memory: 0 };
        }
    }

    // Get disk usage of a directory in MB (async)
    async _getDiskUsage(directory) {
        try {
            await fsp.access(directory);
        } catch {
            return 0;
        }

        let totalSize = 0;
        const walk = async (dir) => {
            try {
                const entries = await fsp.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    try {
                        if (entry.isFile()) {
                            const stat = await fsp.stat(fullPath);
                            totalSize += stat.size;
                        } else if (entry.isDirectory()) {
                            await walk(fullPath);
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        };

        await walk(directory);
        return totalSize / (1024 * 1024); // Convert to MB
    }

    // Get summary for all servers
    getSummary() {
        const result = [];
        for (const [id, instance] of this.serverManager.servers) {
            result.push({
                serverId: id,
                serverName: instance.name,
                limits: this.getLimits(id),
                usage: this.getUsage(id),
                running: instance.status === 'running'
            });
        }
        return result;
    }
}

module.exports = ResourceLimiter;
