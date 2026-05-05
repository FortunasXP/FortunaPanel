const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');
const { getSqliteStore } = require('../db/sqlite');

const TASKS_PATH = path.join(config.dataDir, 'scheduled-tasks.json');

const SERVER_TYPES = ['restart', 'backup', 'command'];
const NETWORK_TYPES = ['network_start', 'network_stop', 'network_restart', 'rolling_restart'];
const ALL_TYPES = [...SERVER_TYPES, ...NETWORK_TYPES];

// Fields the caller may update via updateTask(). Anything else is ignored so
// a malicious body cannot rewrite server-managed fields (id, createdAt, etc.).
const UPDATABLE_FIELDS = new Set(['name', 'intervalMinutes', 'command', 'enabled', 'type', 'maxBackups']);

// Backup retention defaults
const DEFAULT_MAX_BACKUPS = 5;
const MIN_MAX_BACKUPS = 1;
const MAX_MAX_BACKUPS = 100;

// Per-task minimum/maximum interval. Matches the route-level validation so
// updateTask() can't sneak a 0-ms interval past us.
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 10080; // 1 week

class Scheduler extends EventEmitter {
    constructor(serverManager, backupManager, activityLog, networkManager) {
        super();
        this.serverManager = serverManager;
        this.backupManager = backupManager;
        this.activityLog = activityLog;
        this.networkManager = networkManager;
        this.tasks = [];
        this._timers = new Map();
        // Task ids currently executing — prevents overlapping runs when a
        // task's work exceeds its interval (setInterval doesn't await).
        this._running = new Set();
        this.store = getSqliteStore();
        this._load();
    }

    _load() {
        if (this.store.enabled) {
            try {
                this.tasks = this.store.loadScheduledTasks();
                return;
            } catch (e) {
                logger.error(`Failed to load scheduled tasks from SQLite: ${e.message}`);
            }
        }
        try {
            if (fs.existsSync(TASKS_PATH)) {
                this.tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
            }
        } catch (e) {
            logger.error(`Failed to load scheduled tasks: ${e.message}`);
            this.tasks = [];
        }
    }

    _save() {
        if (this.store.enabled) {
            this.store.saveScheduledTasks(this.tasks);
            return;
        }
        // Atomic write: tmp file + fsync + rename so a crash mid-write can't
        // leave tasks.json truncated.
        const tmpPath = TASKS_PATH + '.tmp';
        try {
            const fd = fs.openSync(tmpPath, 'w');
            try {
                fs.writeFileSync(fd, JSON.stringify(this.tasks, null, 2));
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(tmpPath, TASKS_PATH);
        } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            logger.error(`Failed to save scheduled tasks: ${e.message}`);
        }
    }

    start() {
        for (const task of this.tasks) {
            if (task.enabled) {
                this._scheduleTask(task);
            }
        }
        logger.info(`Scheduler started with ${this.tasks.filter(t => t.enabled).length} active task(s)`);
    }

    stop() {
        for (const [id, timer] of this._timers) {
            clearInterval(timer);
        }
        this._timers.clear();
    }

    createTask(options) {
        const task = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            serverId: options.serverId || null,
            networkId: options.networkId || null,
            type: options.type,
            name: options.name || this._defaultName(options.type),
            intervalMinutes: options.intervalMinutes,
            command: options.command || null,
            maxBackups: options.type === 'backup' ? (options.maxBackups || DEFAULT_MAX_BACKUPS) : undefined,
            enabled: options.enabled !== false,
            createdAt: new Date().toISOString(),
            lastRun: null,
            nextRun: null
        };

        this.tasks.push(task);
        this._save();

        if (task.enabled) {
            this._scheduleTask(task);
        }

        if (this.activityLog) {
            this.activityLog.log('schedule.create', {
                taskId: task.id,
                serverId: task.serverId,
                networkId: task.networkId,
                type: task.type,
                intervalMinutes: task.intervalMinutes
            });
        }

        return task;
    }

    updateTask(taskId, updates) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) throw new Error('Task not found');

        // Whitelist + validate. Unknown fields (id, serverId, createdAt,
        // lastRun, nextRun, networkId) are silently ignored — the caller
        // can't rewrite server-managed state through this endpoint.
        const cleaned = {};
        for (const [key, value] of Object.entries(updates || {})) {
            if (!UPDATABLE_FIELDS.has(key)) continue;
            cleaned[key] = value;
        }

        if ('intervalMinutes' in cleaned) {
            const n = Number(cleaned.intervalMinutes);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) {
                throw new Error(`intervalMinutes must be an integer between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`);
            }
            cleaned.intervalMinutes = n;
        }
        if ('type' in cleaned) {
            if (!ALL_TYPES.includes(cleaned.type)) {
                throw new Error(`Invalid task type: ${cleaned.type}`);
            }
            // Don't allow crossing server<->network task boundary; a network
            // task cannot be re-typed to a server task because the required
            // ids aren't present, and vice-versa.
            if (task.networkId && !NETWORK_TYPES.includes(cleaned.type)) {
                throw new Error('Cannot switch a network task to a server task');
            }
            if (task.serverId && !SERVER_TYPES.includes(cleaned.type)) {
                throw new Error('Cannot switch a server task to a network task');
            }
        }
        if ('name' in cleaned && typeof cleaned.name === 'string') {
            cleaned.name = cleaned.name.trim().slice(0, 120);
        }
        if ('command' in cleaned && cleaned.command !== null && typeof cleaned.command === 'string') {
            cleaned.command = cleaned.command.slice(0, 2000);
        }
        if ('enabled' in cleaned) {
            cleaned.enabled = Boolean(cleaned.enabled);
        }
        if ('maxBackups' in cleaned) {
            const n = Number(cleaned.maxBackups);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_MAX_BACKUPS || n > MAX_MAX_BACKUPS) {
                throw new Error(`maxBackups must be an integer between ${MIN_MAX_BACKUPS} and ${MAX_MAX_BACKUPS}`);
            }
            cleaned.maxBackups = n;
        }

        this._unscheduleTask(taskId);
        Object.assign(task, cleaned);
        this._save();

        if (task.enabled) {
            this._scheduleTask(task);
        }

        return task;
    }

    deleteTask(taskId) {
        const existed = this.tasks.some(t => t.id === taskId);
        if (!existed) return false;
        this._unscheduleTask(taskId);
        this.tasks = this.tasks.filter(t => t.id !== taskId);
        this._save();
        return true;
    }

    toggleTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) throw new Error('Task not found');

        task.enabled = !task.enabled;
        this._save();

        if (task.enabled) {
            this._scheduleTask(task);
        } else {
            this._unscheduleTask(taskId);
        }

        return task;
    }

    getTasks(serverId = null, networkId = null) {
        let filtered = [...this.tasks];
        if (serverId) filtered = filtered.filter(t => t.serverId === serverId);
        if (networkId) filtered = filtered.filter(t => t.networkId === networkId);
        return filtered;
    }

    async executeTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) throw new Error('Task not found');
        await this._executeTask(task);
    }

    _scheduleTask(task) {
        this._unscheduleTask(task.id);

        // Defensive: load-from-disk or an update could have left an invalid
        // interval; refuse to schedule rather than tight-loop setInterval.
        const minutes = Number(task.intervalMinutes);
        if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
            logger.warn(`Skipping task "${task.name}" (${task.id}): invalid intervalMinutes=${task.intervalMinutes}`);
            return;
        }

        const intervalMs = minutes * 60 * 1000;
        task.nextRun = new Date(Date.now() + intervalMs).toISOString();
        this._save();

        const timer = setInterval(() => {
            // Swallow rejections — _executeTask handles its own errors and
            // emits events. An unhandled rejection here would crash Node.
            this._executeTask(task).catch(err => {
                logger.error(`Scheduler tick crashed for "${task.name}": ${err.message}`);
            });
        }, intervalMs);
        this._timers.set(task.id, timer);

        const target = task.networkId ? `network ${task.networkId}` : `server ${task.serverId}`;
        logger.info(`Scheduled task "${task.name}" every ${minutes}m for ${target}`);
    }

    _unscheduleTask(taskId) {
        const timer = this._timers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this._timers.delete(taskId);
        }
    }

    async _executeTask(task) {
        // Drop overlapping runs. If the previous execution is still going
        // (e.g. a backup running longer than the interval) we skip rather
        // than pile up work and blow past memory/disk limits.
        if (this._running.has(task.id)) {
            logger.warn(`Skipping task "${task.name}": previous run still in progress`);
            this.emit('task-skipped', { taskId: task.id, name: task.name, reason: 'overlap' });
            return;
        }
        this._running.add(task.id);
        this.emit('task-started', { taskId: task.id, name: task.name, type: task.type });

        try {
            if (task.networkId) {
                await this._runNetworkTask(task);
            } else {
                await this._runServerTask(task);
            }

            task.lastRun = new Date().toISOString();
            const minutes = Number(task.intervalMinutes) || MIN_INTERVAL_MINUTES;
            task.nextRun = new Date(Date.now() + minutes * 60 * 1000).toISOString();
            this._save();

            if (this.activityLog) {
                this.activityLog.log('schedule.execute', {
                    taskId: task.id,
                    serverId: task.serverId,
                    networkId: task.networkId,
                    type: task.type,
                    name: task.name
                }, 'scheduler');
            }

            this.emit('task-completed', { taskId: task.id, name: task.name, type: task.type });
        } catch (e) {
            logger.error(`Scheduled task "${task.name}" failed: ${e.message}`);
            if (this.activityLog) {
                this.activityLog.log('schedule.failed', {
                    taskId: task.id,
                    serverId: task.serverId,
                    networkId: task.networkId,
                    type: task.type,
                    name: task.name,
                    error: e.message
                }, 'scheduler');
            }
            this.emit('task-failed', { taskId: task.id, name: task.name, type: task.type, error: e.message });
        } finally {
            this._running.delete(task.id);
        }
    }

    async _runServerTask(task) {
        const server = this.serverManager.getServer(task.serverId);
        if (!server) {
            throw new Error(`Server ${task.serverId} not found`);
        }

        logger.info(`Executing scheduled task: ${task.name} (${task.type}) for ${server.name}`);

        switch (task.type) {
            case 'restart':
                if (server.status === 'running') {
                    await this.serverManager.restartServer(task.serverId);
                }
                break;

            case 'backup':
                if (!this.backupManager) {
                    throw new Error('Backup manager not available');
                }
                await this.backupManager.createBackup(server, 'scheduled-backup');
                // Retention: prune oldest scheduled backups if over maxBackups limit
                await this._pruneScheduledBackups(task, server);
                break;

            case 'command':
                if (task.command && server.status === 'running') {
                    server.sendCommand(task.command);
                }
                break;

            default:
                throw new Error(`Unknown server task type: ${task.type}`);
        }
    }

    async _runNetworkTask(task) {
        if (!this.networkManager) {
            throw new Error('Network manager not available');
        }
        const network = this.networkManager.getNetwork(task.networkId);
        if (!network) {
            throw new Error(`Network ${task.networkId} not found`);
        }

        logger.info(`Executing scheduled task: ${task.name} (${task.type}) for network ${network.name}`);

        switch (task.type) {
            case 'network_start':
                await this.networkManager.startNetwork(task.networkId);
                break;

            case 'network_stop':
                await this.networkManager.stopNetwork(task.networkId);
                break;

            case 'network_restart':
                await this.networkManager.stopNetwork(task.networkId);
                await new Promise(r => setTimeout(r, 3000));
                await this.networkManager.startNetwork(task.networkId);
                break;

            case 'rolling_restart':
                await this.networkManager.rollingRestart(task.networkId);
                break;

            default:
                throw new Error(`Unknown network task type: ${task.type}`);
        }
    }

    /**
     * Prune old scheduled backups for a server, keeping at most task.maxBackups.
     * Only deletes backups created by the scheduler (createdBy === 'scheduled-backup').
     */
    async _pruneScheduledBackups(task, server) {
        const maxBackups = task.maxBackups || DEFAULT_MAX_BACKUPS;
        try {
            const allBackups = this.backupManager.listBackups(server.id);
            // Only consider backups made by the scheduler
            const scheduledBackups = allBackups.filter(b => b.createdBy === 'scheduled-backup');
            if (scheduledBackups.length <= maxBackups) return;

            // listBackups returns newest-first, so slice off the ones to keep
            const toDelete = scheduledBackups.slice(maxBackups);
            for (const backup of toDelete) {
                try {
                    this.backupManager.deleteBackup(server.id, backup.filename, 'scheduler');
                    logger.info(`Retention: deleted old scheduled backup ${backup.filename} for ${server.name}`);
                } catch (e) {
                    logger.warn(`Retention: failed to delete ${backup.filename}: ${e.message}`);
                }
            }
        } catch (e) {
            logger.warn(`Retention pruning failed for ${server.name}: ${e.message}`);
        }
    }

    _defaultName(type) {
        switch (type) {
            case 'restart': return 'Auto Restart';
            case 'backup': return 'Auto Backup';
            case 'command': return 'Scheduled Command';
            case 'network_start': return 'Network Start';
            case 'network_stop': return 'Network Stop';
            case 'network_restart': return 'Network Restart';
            case 'rolling_restart': return 'Rolling Restart';
            default: return 'Scheduled Task';
        }
    }
}

Scheduler.SERVER_TYPES = SERVER_TYPES;
Scheduler.NETWORK_TYPES = NETWORK_TYPES;

module.exports = Scheduler;
