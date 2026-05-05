const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config/default');
const logger = require('../utils/logger');
const { safeFilename } = require('../utils/validation');

const BACKUPS_DIR = path.join(config.dataDir, 'backups');

// Double-check that a fully resolved path stays inside the backups root for
// a given serverId. Guards against traversal even if `safeFilename` is bypassed.
function resolveBackupPath(serverId, filename) {
    const serverBackupDir = path.resolve(BACKUPS_DIR, serverId);
    const full = path.resolve(serverBackupDir, filename);
    const rel = path.relative(serverBackupDir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
        throw new Error('Invalid backup path');
    }
    return full;
}

class BackupManager {
    constructor(activityLog) {
        this.activityLog = activityLog;
        if (!fs.existsSync(BACKUPS_DIR)) {
            fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        }
    }

    /**
     * Create a backup of a server directory as a zip file
     */
    async createBackup(serverInstance, user = 'system', onProgress = null) {
        const serverDir = serverInstance.config.directory;
        const serverId = serverInstance.id;
        const serverName = serverInstance.name;

        // Create server-specific backup directory
        const serverBackupDir = path.join(BACKUPS_DIR, serverId);
        if (!fs.existsSync(serverBackupDir)) {
            fs.mkdirSync(serverBackupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${serverName.replace(/[^a-zA-Z0-9-_]/g, '_')}_${timestamp}.zip`;
        const backupPath = resolveBackupPath(serverId, filename);

        logger.info(`Creating backup for ${serverName}: ${filename}`);
        if (onProgress) onProgress(5, 'Starting backup');

        return new Promise((resolve, reject) => {
            const { file, args, cwd } = buildCompressArgs(serverDir, backupPath);

            execFile(file, args, { maxBuffer: 1024 * 1024 * 50, timeout: 300000, cwd }, (error) => {
                if (error) {
                    logger.error(`Backup failed for ${serverName}: ${error.message}`);
                    reject(new Error(`Backup failed: ${error.message}`));
                    return;
                }
                if (onProgress) onProgress(90, 'Finalizing backup');

                const stat = fs.statSync(backupPath);
                const backup = {
                    filename,
                    path: backupPath,
                    serverId,
                    serverName,
                    size: stat.size,
                    createdAt: new Date().toISOString(),
                    createdBy: user
                };

                // Save metadata
                this._saveMetadata(serverId, backup);

                if (this.activityLog) {
                    this.activityLog.log('backup.create', {
                        serverId,
                        serverName,
                        filename,
                        size: stat.size
                    }, user);
                }

                logger.info(`Backup created: ${filename} (${this._formatSize(stat.size)})`);
                if (onProgress) onProgress(100, 'Backup completed');
                resolve(backup);
            });
        });
    }

    /**
     * Restore a server from a backup.
     * Atomic: extracts into a temp directory, then swaps with the live server
     * directory. Old contents are preserved until swap succeeds, then removed.
     */
    async restoreBackup(serverInstance, filename, user = 'system', onProgress = null) {
        const serverId = serverInstance.id;
        const serverDir = serverInstance.config.directory;

        const safeName = safeFilename(filename, 'filename');
        const backupPath = resolveBackupPath(serverId, safeName);

        if (!fs.existsSync(backupPath)) {
            throw new Error('Backup file not found');
        }

        if (serverInstance.status === 'running') {
            throw new Error('Server must be stopped before restoring');
        }

        logger.info(`Restoring backup ${safeName} for ${serverInstance.name}`);
        if (onProgress) onProgress(5, 'Starting restore');

        const parent = path.dirname(serverDir);
        const base = path.basename(serverDir);
        const stamp = Date.now();
        const stagingDir = path.join(parent, `.${base}.restore-${stamp}`);
        const backupDirForRollback = path.join(parent, `.${base}.old-${stamp}`);

        // Extract into staging dir
        await new Promise((resolve, reject) => {
            fs.mkdirSync(stagingDir, { recursive: true });
            const { file, args } = buildExpandArgs(backupPath, stagingDir);
            execFile(file, args, { maxBuffer: 1024 * 1024 * 50, timeout: 300000 }, (error) => {
                if (error) {
                    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
                    logger.error(`Restore extraction failed: ${error.message}`);
                    return reject(new Error(`Restore failed: ${error.message}`));
                }
                resolve();
            });
        });

        if (onProgress) onProgress(75, 'Swapping directories');

        // Swap: rename live dir aside, move staging into place, then drop old
        try {
            if (fs.existsSync(serverDir)) {
                fs.renameSync(serverDir, backupDirForRollback);
            }
            fs.renameSync(stagingDir, serverDir);
        } catch (swapErr) {
            // Attempt rollback
            try {
                if (!fs.existsSync(serverDir) && fs.existsSync(backupDirForRollback)) {
                    fs.renameSync(backupDirForRollback, serverDir);
                }
            } catch (_) {}
            try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
            logger.error(`Restore swap failed: ${swapErr.message}`);
            throw new Error(`Restore failed during swap: ${swapErr.message}`);
        }

        // Drop rollback copy now that swap succeeded
        try { fs.rmSync(backupDirForRollback, { recursive: true, force: true }); } catch (_) {}

        if (onProgress) onProgress(95, 'Finalizing restore');

        if (this.activityLog) {
            this.activityLog.log('backup.restore', {
                serverId,
                serverName: serverInstance.name,
                filename: safeName
            }, user);
        }

        logger.info(`Backup restored: ${safeName}`);
        if (onProgress) onProgress(100, 'Restore completed');
        return { success: true };
    }

    /**
     * List backups for a server
     */
    listBackups(serverId) {
        const serverBackupDir = path.join(BACKUPS_DIR, serverId);
        if (!fs.existsSync(serverBackupDir)) return [];

        const metadata = this._loadMetadata(serverId);
        const files = fs.readdirSync(serverBackupDir)
            .filter(f => f.endsWith('.zip'))
            .map(filename => {
                const filePath = path.join(serverBackupDir, filename);
                const stat = fs.statSync(filePath);
                const meta = metadata.find(m => m.filename === filename) || {};
                return {
                    filename,
                    size: stat.size,
                    createdAt: meta.createdAt || stat.mtime.toISOString(),
                    createdBy: meta.createdBy || 'unknown'
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return files;
    }

    /**
     * Delete a backup
     */
    deleteBackup(serverId, filename, user = 'system') {
        const safeName = safeFilename(filename, 'filename');
        const backupPath = resolveBackupPath(serverId, safeName);

        try {
            fs.unlinkSync(backupPath);
        } catch (e) {
            if (e.code === 'ENOENT') throw new Error('Backup not found');
            throw e;
        }

        // Update metadata
        const metadata = this._loadMetadata(serverId).filter(m => m.filename !== safeName);
        this._saveMetadataRaw(serverId, metadata);

        if (this.activityLog) {
            this.activityLog.log('backup.delete', { serverId, filename: safeName }, user);
        }

        logger.info(`Backup deleted: ${safeName}`);
        return { success: true };
    }

    _loadMetadata(serverId) {
        const metaPath = path.join(BACKUPS_DIR, serverId, 'metadata.json');
        try {
            if (fs.existsSync(metaPath)) {
                return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            }
        } catch (e) {}
        return [];
    }

    _saveMetadata(serverId, backup) {
        const metadata = this._loadMetadata(serverId);
        metadata.push(backup);
        this._saveMetadataRaw(serverId, metadata);
    }

    _saveMetadataRaw(serverId, metadata) {
        const metaPath = path.join(BACKUPS_DIR, serverId, 'metadata.json');
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    }

    _formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return `${bytes.toFixed(1)} ${units[i]}`;
    }
}

// PowerShell single-quoted strings escape ' as ''. Paths go into -Command, so we
// build the inner script and hand it as one argument via execFile — no shell parsing.
function psQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function buildCompressArgs(serverDir, backupPath) {
    if (process.platform === 'win32') {
        const script = `Compress-Archive -Path ${psQuote(path.join(serverDir, '*'))} -DestinationPath ${psQuote(backupPath)} -Force`;
        return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
    }
    return { file: 'zip', args: ['-r', backupPath, '.'], cwd: serverDir };
}

function buildExpandArgs(backupPath, destDir) {
    if (process.platform === 'win32') {
        const script = `Expand-Archive -Path ${psQuote(backupPath)} -DestinationPath ${psQuote(destDir)} -Force`;
        return { file: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
    }
    return { file: 'unzip', args: ['-o', backupPath, '-d', destDir] };
}

module.exports = BackupManager;
