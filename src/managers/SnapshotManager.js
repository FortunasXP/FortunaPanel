const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('../config/default');
const logger = require('../utils/logger');

const SNAPSHOTS_DIR = path.join(config.dataDir, 'snapshots');
const METADATA_FILE = 'snapshots.json';

// Helper: PowerShell-safe quoting
function psQuote(s) {
    return `'${s.replace(/'/g, "''")}'`;
}

function buildCompressArgs(sourceDir, destPath) {
    if (process.platform === 'win32') {
        const script = `Compress-Archive -Path ${psQuote(path.join(sourceDir, '*'))} -DestinationPath ${psQuote(destPath)} -Force`;
        return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
    }
    return { file: 'zip', args: ['-r', destPath, '.'], cwd: sourceDir };
}

function buildExpandArgs(archivePath, destDir) {
    if (process.platform === 'win32') {
        const script = `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(destDir)} -Force`;
        return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
    }
    return { file: 'unzip', args: ['-o', archivePath, '-d', destDir] };
}

class SnapshotManager {
    constructor(serverManager, activityLog) {
        this.serverManager = serverManager;
        this.activityLog = activityLog;
        this._metadata = new Map(); // serverId -> [snapshot entries]

        if (!fs.existsSync(SNAPSHOTS_DIR)) {
            fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
        }
    }

    /**
     * Create a full snapshot of a server (world, plugins, configs — everything).
     * Server must be stopped for data consistency.
     */
    async createSnapshot(serverId, { name, description = '', user = 'system' } = {}) {
        const instance = this.serverManager.getServer(serverId);
        if (!instance) throw new Error('Server not found');

        if (instance.status === 'running' || instance.status === 'starting') {
            throw new Error('Server must be stopped before creating a snapshot');
        }

        const serverDir = instance.config.directory;
        if (!fs.existsSync(serverDir)) {
            throw new Error('Server directory not found');
        }

        const id = crypto.randomUUID();
        const snapshotName = name || `Snapshot ${new Date().toLocaleString()}`;
        const serverSnapshotDir = path.join(SNAPSHOTS_DIR, serverId);
        if (!fs.existsSync(serverSnapshotDir)) {
            fs.mkdirSync(serverSnapshotDir, { recursive: true });
        }

        const filename = `${id}.zip`;
        const archivePath = path.join(serverSnapshotDir, filename);

        logger.info(`Creating snapshot "${snapshotName}" for server ${instance.name}`);

        // Compress entire server directory
        await new Promise((resolve, reject) => {
            const { file, args, cwd } = buildCompressArgs(serverDir, archivePath);
            execFile(file, args, {
                maxBuffer: 1024 * 1024 * 100,
                timeout: 600000, // 10 min for large servers
                cwd
            }, (error) => {
                if (error) {
                    reject(new Error(`Snapshot compression failed: ${error.message}`));
                } else {
                    resolve();
                }
            });
        });

        const stat = fs.statSync(archivePath);

        const snapshot = {
            id,
            name: snapshotName,
            description,
            filename,
            serverId,
            serverName: instance.name,
            size: stat.size,
            createdAt: new Date().toISOString(),
            createdBy: user,
            serverConfig: {
                memory: instance.config.memory,
                jvmArgs: instance.config.jvmArgs || [],
                jarFile: instance.config.jarFile,
                type: instance.config.type,
                version: instance.config.version
            }
        };

        this._getMetadata(serverId).push(snapshot);
        this._saveMetadata(serverId);

        if (this.activityLog) {
            this.activityLog.log('snapshot.create', {
                serverId,
                serverName: instance.name,
                snapshotId: id,
                snapshotName,
                size: stat.size
            }, user);
        }

        logger.info(`Snapshot "${snapshotName}" created (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        return snapshot;
    }

    /**
     * Restore a server from a snapshot.
     * Server must be stopped. Replaces the entire server directory.
     */
    async restoreSnapshot(serverId, snapshotId, { user = 'system' } = {}) {
        const instance = this.serverManager.getServer(serverId);
        if (!instance) throw new Error('Server not found');

        if (instance.status === 'running' || instance.status === 'starting') {
            throw new Error('Server must be stopped before restoring a snapshot');
        }

        const snapshot = this.getSnapshot(serverId, snapshotId);
        if (!snapshot) throw new Error('Snapshot not found');

        const archivePath = path.join(SNAPSHOTS_DIR, serverId, snapshot.filename);
        if (!fs.existsSync(archivePath)) {
            throw new Error('Snapshot archive file not found');
        }

        const serverDir = instance.config.directory;

        logger.info(`Restoring snapshot "${snapshot.name}" for server ${instance.name}`);

        // Clear the server directory (except the directory itself)
        const entries = await fsp.readdir(serverDir);
        for (const entry of entries) {
            await fsp.rm(path.join(serverDir, entry), { recursive: true, force: true });
        }

        // Extract snapshot into server directory
        await new Promise((resolve, reject) => {
            const { file, args } = buildExpandArgs(archivePath, serverDir);
            execFile(file, args, {
                maxBuffer: 1024 * 1024 * 100,
                timeout: 600000
            }, (error) => {
                if (error) {
                    reject(new Error(`Snapshot restore failed: ${error.message}`));
                } else {
                    resolve();
                }
            });
        });

        // Update the snapshot metadata to track restores
        snapshot.lastRestoredAt = new Date().toISOString();
        snapshot.lastRestoredBy = user;
        this._saveMetadata(serverId);

        if (this.activityLog) {
            this.activityLog.log('snapshot.restore', {
                serverId,
                serverName: instance.name,
                snapshotId,
                snapshotName: snapshot.name
            }, user);
        }

        logger.info(`Snapshot "${snapshot.name}" restored successfully`);
        return snapshot;
    }

    /**
     * Delete a snapshot.
     */
    async deleteSnapshot(serverId, snapshotId, user = 'system') {
        const snapshots = this._getMetadata(serverId);
        const idx = snapshots.findIndex(s => s.id === snapshotId);
        if (idx === -1) throw new Error('Snapshot not found');

        const snapshot = snapshots[idx];
        const archivePath = path.join(SNAPSHOTS_DIR, serverId, snapshot.filename);

        // Remove archive file
        try {
            if (fs.existsSync(archivePath)) {
                await fsp.unlink(archivePath);
            }
        } catch (e) {
            logger.warn(`Failed to delete snapshot file: ${e.message}`);
        }

        snapshots.splice(idx, 1);
        this._saveMetadata(serverId);

        if (this.activityLog) {
            this.activityLog.log('snapshot.delete', {
                serverId,
                snapshotId,
                snapshotName: snapshot.name
            }, user);
        }

        logger.info(`Snapshot "${snapshot.name}" deleted`);
        return true;
    }

    /**
     * List all snapshots for a server.
     */
    listSnapshots(serverId) {
        return this._getMetadata(serverId).map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
            size: s.size,
            createdAt: s.createdAt,
            createdBy: s.createdBy,
            lastRestoredAt: s.lastRestoredAt || null,
            lastRestoredBy: s.lastRestoredBy || null,
            serverConfig: s.serverConfig
        }));
    }

    /**
     * Get a single snapshot by ID.
     */
    getSnapshot(serverId, snapshotId) {
        return this._getMetadata(serverId).find(s => s.id === snapshotId) || null;
    }

    /**
     * Get the archive file path for download.
     */
    getArchivePath(serverId, snapshotId) {
        const snapshot = this.getSnapshot(serverId, snapshotId);
        if (!snapshot) return null;
        const archivePath = path.join(SNAPSHOTS_DIR, serverId, snapshot.filename);
        if (!fs.existsSync(archivePath)) return null;
        return archivePath;
    }

    /**
     * Get total snapshot disk usage for a server.
     */
    getDiskUsage(serverId) {
        const snapshots = this._getMetadata(serverId);
        return {
            count: snapshots.length,
            totalSize: snapshots.reduce((sum, s) => sum + (s.size || 0), 0)
        };
    }

    // --- Internal ---

    _getMetadata(serverId) {
        if (this._metadata.has(serverId)) return this._metadata.get(serverId);

        const metaPath = path.join(SNAPSHOTS_DIR, serverId, METADATA_FILE);
        let data = [];
        try {
            if (fs.existsSync(metaPath)) {
                data = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            }
        } catch (e) {
            logger.warn(`Failed to load snapshot metadata for ${serverId}: ${e.message}`);
            data = [];
        }

        this._metadata.set(serverId, data);
        return data;
    }

    _saveMetadata(serverId) {
        const data = this._metadata.get(serverId);
        if (!data) return;

        const serverDir = path.join(SNAPSHOTS_DIR, serverId);
        if (!fs.existsSync(serverDir)) {
            fs.mkdirSync(serverDir, { recursive: true });
        }

        const metaPath = path.join(serverDir, METADATA_FILE);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(data, null, 2));
        } catch (e) {
            logger.warn(`Failed to save snapshot metadata: ${e.message}`);
        }
    }
}

module.exports = SnapshotManager;
