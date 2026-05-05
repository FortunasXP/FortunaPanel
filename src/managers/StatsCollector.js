const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/default');

const STATS_DIR = path.join(config.dataDir, 'stats');
const COLLECT_INTERVAL = 5 * 60 * 1000;  // 5 minutes
const RAW_RETENTION = 288;                // 24h at 5-min intervals
const HOURLY_RETENTION = 168;             // 7 days
const DAILY_RETENTION = 30;               // 30 days

class StatsCollector extends EventEmitter {
    constructor(serverManager, systemMonitor) {
        super();
        this.serverManager = serverManager;
        this.systemMonitor = systemMonitor;
        this._collectInterval = null;
        this._hourlyInterval = null;
        this._dailyInterval = null;
        this._cache = new Map(); // serverId -> stats data

        // Ensure stats directory exists
        if (!fs.existsSync(STATS_DIR)) {
            fs.mkdirSync(STATS_DIR, { recursive: true });
        }
    }

    start() {
        // Collect every 5 minutes
        this._collectInterval = setInterval(() => this._collect(), COLLECT_INTERVAL);

        // Aggregate hourly (check every 5 min, aggregate on the hour)
        this._hourlyInterval = setInterval(() => this._checkHourlyAggregation(), COLLECT_INTERVAL);

        // Aggregate daily (check every hour)
        this._dailyInterval = setInterval(() => this._checkDailyAggregation(), 60 * 60 * 1000);

        // First collection after 30 seconds (let servers boot)
        setTimeout(() => this._collect(), 30000);

        // Request TPS from Paper/Spigot servers periodically
        this._tpsInterval = setInterval(() => this._requestTps(), COLLECT_INTERVAL);

        logger.info('StatsCollector started');
    }

    stop() {
        if (this._collectInterval) clearInterval(this._collectInterval);
        if (this._hourlyInterval) clearInterval(this._hourlyInterval);
        if (this._dailyInterval) clearInterval(this._dailyInterval);
        if (this._tpsInterval) clearInterval(this._tpsInterval);
        this._collectInterval = null;
        this._hourlyInterval = null;
        this._dailyInterval = null;
        this._tpsInterval = null;

        // Flush all cached data
        for (const [serverId] of this._cache) {
            this._saveStats(serverId);
        }
        logger.info('StatsCollector stopped');
    }

    _collect() {
        const now = Date.now();

        for (const server of this.serverManager.servers.values()) {
            const stats = this._loadStats(server.id);
            const isOnline = server.status === 'running';

            stats.raw.push({
                ts: now,
                players: isOnline ? server.players.size : 0,
                tps: isOnline ? (server.lastTps || null) : null,
                online: isOnline
            });

            // Prune raw data
            if (stats.raw.length > RAW_RETENTION) {
                stats.raw = stats.raw.slice(-RAW_RETENTION);
            }

            this._saveStats(server.id);
        }
    }

    _requestTps() {
        // TPS command is only available on Paper/Spigot (and forks like Purpur).
        // Vanilla, Forge, Fabric, and proxy servers don't support it.
        const TPS_TYPES = new Set(['paper', 'spigot', 'purpur']);
        for (const server of this.serverManager.servers.values()) {
            if (server.status === 'running' && server.process) {
                if (TPS_TYPES.has(server.config.type)) {
                    server.sendCommand('tps');
                }
            }
        }
    }

    _checkHourlyAggregation() {
        const now = new Date();
        // Only aggregate at the top of the hour (within first 5 min)
        if (now.getMinutes() > 5) return;

        for (const server of this.serverManager.servers.values()) {
            const stats = this._loadStats(server.id);
            const hourAgo = Date.now() - (60 * 60 * 1000);

            // Get raw points from the last hour
            const hourRaw = stats.raw.filter(r => r.ts >= hourAgo);
            if (hourRaw.length === 0) continue;

            // Check if we already have an hourly entry for this hour
            const hourStart = new Date(now);
            hourStart.setMinutes(0, 0, 0);
            const hourTs = hourStart.getTime() - (60 * 60 * 1000); // Previous hour

            if (stats.hourly.length > 0 && stats.hourly[stats.hourly.length - 1].ts >= hourTs) {
                continue; // Already aggregated
            }

            const onlinePoints = hourRaw.filter(r => r.online);
            const tpsPoints = hourRaw.filter(r => r.tps !== null);
            const playerValues = hourRaw.map(r => r.players);

            stats.hourly.push({
                ts: hourTs,
                avgPlayers: playerValues.length ? +(playerValues.reduce((a, b) => a + b, 0) / playerValues.length).toFixed(1) : 0,
                maxPlayers: Math.max(0, ...playerValues),
                avgTps: tpsPoints.length ? +(tpsPoints.reduce((a, b) => a + b.tps, 0) / tpsPoints.length).toFixed(1) : null,
                uptime: onlinePoints.length * COLLECT_INTERVAL
            });

            // Prune hourly data
            if (stats.hourly.length > HOURLY_RETENTION) {
                stats.hourly = stats.hourly.slice(-HOURLY_RETENTION);
            }

            this._saveStats(server.id);
        }
    }

    _checkDailyAggregation() {
        const now = new Date();
        // Only aggregate near midnight (within first hour)
        if (now.getHours() > 0) return;

        for (const server of this.serverManager.servers.values()) {
            const stats = this._loadStats(server.id);

            // Get hourly points from the last 24 hours
            const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
            const dayHourly = stats.hourly.filter(h => h.ts >= dayAgo);
            if (dayHourly.length === 0) continue;

            // Check if we already have a daily entry for today
            const dayStart = new Date(now);
            dayStart.setHours(0, 0, 0, 0);
            const dayTs = dayStart.getTime() - (24 * 60 * 60 * 1000); // Previous day

            if (stats.daily.length > 0 && stats.daily[stats.daily.length - 1].ts >= dayTs) {
                continue; // Already aggregated
            }

            const playerValues = dayHourly.map(h => h.avgPlayers);
            const tpsValues = dayHourly.filter(h => h.avgTps !== null).map(h => h.avgTps);
            const uptimeValues = dayHourly.map(h => h.uptime);

            // Find peak hour
            let peakHour = 0;
            let peakPlayers = 0;
            for (const h of dayHourly) {
                const hour = new Date(h.ts).getHours();
                if (h.maxPlayers > peakPlayers) {
                    peakPlayers = h.maxPlayers;
                    peakHour = hour;
                }
            }

            stats.daily.push({
                ts: dayTs,
                avgPlayers: playerValues.length ? +(playerValues.reduce((a, b) => a + b, 0) / playerValues.length).toFixed(1) : 0,
                maxPlayers: Math.max(0, ...dayHourly.map(h => h.maxPlayers)),
                avgTps: tpsValues.length ? +(tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length).toFixed(1) : null,
                totalUptime: uptimeValues.reduce((a, b) => a + b, 0),
                peakHour
            });

            // Prune daily data
            if (stats.daily.length > DAILY_RETENTION) {
                stats.daily = stats.daily.slice(-DAILY_RETENTION);
            }

            this._saveStats(server.id);
        }
    }

    _loadStats(serverId) {
        if (this._cache.has(serverId)) return this._cache.get(serverId);

        const filePath = path.join(STATS_DIR, `${serverId}.json`);
        let stats = { raw: [], hourly: [], daily: [] };

        if (fs.existsSync(filePath)) {
            try {
                stats = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (!stats.raw) stats.raw = [];
                if (!stats.hourly) stats.hourly = [];
                if (!stats.daily) stats.daily = [];
            } catch {
                stats = { raw: [], hourly: [], daily: [] };
            }
        }

        // Prune old data on load
        const now = Date.now();
        stats.raw = stats.raw.filter(r => now - r.ts < 25 * 60 * 60 * 1000); // 25h buffer
        stats.hourly = stats.hourly.filter(h => now - h.ts < 8 * 24 * 60 * 60 * 1000); // 8d buffer
        stats.daily = stats.daily.filter(d => now - d.ts < 31 * 24 * 60 * 60 * 1000); // 31d buffer

        this._cache.set(serverId, stats);
        return stats;
    }

    _saveStats(serverId) {
        const stats = this._cache.get(serverId);
        if (!stats) return;

        const filePath = path.join(STATS_DIR, `${serverId}.json`);
        try {
            fs.writeFileSync(filePath, JSON.stringify(stats));
        } catch (err) {
            logger.error(`Failed to save stats for ${serverId}: ${err.message}`);
        }
    }

    getHistory(serverId, range = '24h') {
        const stats = this._loadStats(serverId);
        const now = Date.now();

        switch (range) {
            case '24h':
                return {
                    range: '24h',
                    interval: COLLECT_INTERVAL,
                    data: stats.raw.filter(r => now - r.ts < 24 * 60 * 60 * 1000)
                };
            case '7d':
                return {
                    range: '7d',
                    interval: 60 * 60 * 1000,
                    data: stats.hourly.filter(h => now - h.ts < 7 * 24 * 60 * 60 * 1000)
                };
            case '30d':
                return {
                    range: '30d',
                    interval: 24 * 60 * 60 * 1000,
                    data: stats.daily.filter(d => now - d.ts < 30 * 24 * 60 * 60 * 1000)
                };
            default:
                return { range: '24h', interval: COLLECT_INTERVAL, data: stats.raw };
        }
    }
}

module.exports = StatsCollector;
