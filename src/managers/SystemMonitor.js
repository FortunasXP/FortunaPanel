const os = require('os');
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
        this.serverHistory = new Map(); // serverId -> { cpu: [], players: [] }
        this._prevCpuInfo = null;
        this._interval = null;
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

        // Per-server stats (player count history)
        if (this.serverManager) {
            for (const server of this.serverManager.servers.values()) {
                if (!this.serverHistory.has(server.id)) {
                    this.serverHistory.set(server.id, { players: [], cpu: [] });
                }
                const sh = this.serverHistory.get(server.id);

                if (server.status === 'running' && server.pid) {
                    sh.players.push(server.players.size);
                } else {
                    sh.players.push(0);
                }

                if (sh.players.length > HISTORY_LENGTH) {
                    sh.players.shift();
                }
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
        return this.serverHistory.get(serverId) || { players: [], cpu: [] };
    }
}

module.exports = SystemMonitor;
