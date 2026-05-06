const os = require('os');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

const HISTORY_LENGTH = 60; // 60 data points = 5 minutes at 5s intervals

class SystemMonitor extends EventEmitter {
    constructor() {
        super();
        this.history = {
            cpu: [],
            memory: [],
            timestamps: []
        };
        this.serverHistory = new Map(); // serverId -> { cpu: [], players: [], memory: [] }
        this._prevCpuInfo = null;
        this._interval = null;
        this._memCache = new Map(); // serverId -> last memory reading (MB)
        this._collectCount = 0;
    }

    start(serverManager) {
        this.serverManager = serverManager;

        // Take initial CPU snapshot
        this._prevCpuInfo = this._getCpuInfo();

        // Collect stats every 5 seconds
        this._interval = setInterval(() => this._collect(), 5000);

        // Collect immediately
        setTimeout(() => this._collect(), 1000);

        logger.info('System monitor started');
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    _getCpuInfo() {
        const cpus = os.cpus();
        let totalIdle = 0, totalTick = 0;
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
    }

    _collect() {
        const now = Date.now();
        this._collectCount++;

        // Only query process memory every 3rd tick (~15s) to avoid
        // excessive process spawns. Cached values fill the gaps.
        const shouldQueryMem = this._collectCount % 3 === 0;

        // CPU usage (percentage)
        const currentCpu = this._getCpuInfo();
        let cpuPercent = 0;
        if (this._prevCpuInfo) {
            const idleDiff = currentCpu.idle - this._prevCpuInfo.idle;
            const totalDiff = currentCpu.total - this._prevCpuInfo.total;
            cpuPercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
        }
        this._prevCpuInfo = currentCpu;

        // Memory usage
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memPercent = Math.round((usedMem / totalMem) * 100);

        // Push to history
        this.history.cpu.push(cpuPercent);
        this.history.memory.push(memPercent);
        this.history.timestamps.push(now);

        // Trim history
        if (this.history.cpu.length > HISTORY_LENGTH) {
            this.history.cpu.shift();
            this.history.memory.shift();
            this.history.timestamps.shift();
        }

        // Per-server stats (player count + real memory history)
        if (this.serverManager) {
            for (const server of this.serverManager.servers.values()) {
                if (!this.serverHistory.has(server.id)) {
                    this.serverHistory.set(server.id, { players: [], cpu: [], memory: [] });
                }
                const sh = this.serverHistory.get(server.id);

                if (server.status === 'running' && server.pid) {
                    sh.players.push(server.players.size);
                    let memMB = this._memCache.get(server.id) || 0;
                    if (shouldQueryMem) {
                        memMB = this._getProcessMemory(server.pid);
                        this._memCache.set(server.id, memMB);
                    }
                    sh.memory.push(memMB);
                } else {
                    sh.players.push(0);
                    sh.memory.push(0);
                    this._memCache.delete(server.id);
                }

                if (sh.players.length > HISTORY_LENGTH) sh.players.shift();
                if (sh.memory.length > HISTORY_LENGTH) sh.memory.shift();
            }
        }

        // Emit for WebSocket broadcast
        this.emit('stats', this.getSnapshot());
    }

    getSnapshot() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const cpus = os.cpus();

        return {
            system: {
                cpu: {
                    current: this.history.cpu[this.history.cpu.length - 1] || 0,
                    history: [...this.history.cpu],
                    cores: cpus.length,
                    model: cpus[0]?.model || 'Unknown'
                },
                memory: {
                    current: this.history.memory[this.history.memory.length - 1] || 0,
                    history: [...this.history.memory],
                    total: totalMem,
                    used: usedMem,
                    free: freeMem
                },
                uptime: os.uptime(),
                platform: process.platform,
                nodeVersion: process.version,
                hostname: os.hostname()
            },
            timestamps: [...this.history.timestamps]
        };
    }

    getServerStats(serverId) {
        const sh = this.serverHistory.get(serverId) || { players: [], cpu: [], memory: [] };
        return {
            players: sh.players,
            cpu: sh.cpu,
            memory: sh.memory,
            currentMemoryMB: this._memCache.get(serverId) || 0
        };
    }

    /**
     * Get actual RSS memory for a process in MB.
     * Uses tasklist on Windows, /proc on Linux.
     */
    _getProcessMemory(pid) {
        if (!pid || typeof pid !== 'number') return 0;

        try {
            if (process.platform === 'win32') {
                const output = execFileSync(
                    'tasklist',
                    ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
                    { timeout: 3000, encoding: 'utf-8', windowsHide: true }
                ).trim();
                const fields = output.match(/"[^"]*"/g);
                if (fields && fields.length >= 5) {
                    const memField = fields[fields.length - 1].replace(/"/g, '');
                    const memKB = parseInt(memField.replace(/\D/g, '')) || 0;
                    return Math.round(memKB / 1024);
                }
            } else {
                // Linux / macOS: read RSS from /proc if available, otherwise ps
                try {
                    const fs = require('fs');
                    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
                    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
                    if (match) {
                        return Math.round(parseInt(match[1]) / 1024);
                    }
                } catch (_) {
                    // /proc not available (macOS) — fall back to ps
                    const output = execFileSync(
                        'ps',
                        ['-p', String(pid), '-o', 'rss='],
                        { timeout: 3000, encoding: 'utf-8' }
                    ).trim();
                    const rssKB = parseInt(output) || 0;
                    return Math.round(rssKB / 1024);
                }
            }
        } catch (_) {}
        return 0;
    }
}

module.exports = SystemMonitor;
