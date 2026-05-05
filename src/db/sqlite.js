const fs = require('fs');
const path = require('path');
const config = require('../config/default');
const logger = require('../utils/logger');

let DatabaseSync = null;
try {
    ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
    logger.warn(`SQLite unavailable, falling back to legacy JSON managers: ${e.message}`);
}

let singleton = null;

class SqliteStore {
    constructor() {
        if (!DatabaseSync) {
            this.enabled = false;
            return;
        }

        this.enabled = true;
        this.dbPath = path.join(config.dataDir, 'panel.db');
        this.db = new DatabaseSync(this.dbPath);
        this._init();
        this._migrateLegacyJson();
    }

    _init() {
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS activity_log (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                details_json TEXT NOT NULL,
                user TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                diff_json TEXT
            );

            CREATE TABLE IF NOT EXISTS permissions_grants (
                server_id TEXT NOT NULL,
                username TEXT NOT NULL,
                permissions_json TEXT NOT NULL,
                PRIMARY KEY (server_id, username)
            );

            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id TEXT PRIMARY KEY,
                server_id TEXT,
                network_id TEXT,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                interval_minutes INTEGER NOT NULL,
                command TEXT,
                enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                last_run TEXT,
                next_run TEXT
            );

            CREATE TABLE IF NOT EXISTS legacy_migrations (
                key TEXT PRIMARY KEY,
                completed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS panel_users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                is_admin INTEGER NOT NULL,
                created_at TEXT,
                two_factor_json TEXT
            );

            CREATE TABLE IF NOT EXISTS panel_meta (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );
        `);
    }

    _isMigrated(key) {
        const row = this.db.prepare('SELECT key FROM legacy_migrations WHERE key = ?').get(key);
        return !!row;
    }

    _markMigrated(key) {
        this.db.prepare('INSERT OR REPLACE INTO legacy_migrations (key, completed_at) VALUES (?, ?)')
            .run(key, new Date().toISOString());
    }

    getMigrationStatus() {
        const keys = ['panel.json', 'activity.json', 'permissions.json', 'scheduled-tasks.json'];
        const rows = this.db.prepare(`
            SELECT key, completed_at
            FROM legacy_migrations
        `).all();
        const byKey = new Map(rows.map(r => [r.key, r.completed_at]));
        return keys.map((key) => ({
            key,
            migrated: byKey.has(key),
            completedAt: byKey.get(key) || null
        }));
    }

    _migrateLegacyJson() {
        if (!this._isMigrated('activity.json')) {
            const p = path.join(config.dataDir, 'activity.json');
            if (fs.existsSync(p)) {
                try {
                    const rows = JSON.parse(fs.readFileSync(p, 'utf-8'));
                    const stmt = this.db.prepare(`
                        INSERT OR REPLACE INTO activity_log (id, action, details_json, user, timestamp, diff_json)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `);
                    const tx = this.db.transaction((items) => {
                        for (const e of items) {
                            stmt.run(
                                e.id,
                                e.action,
                                JSON.stringify(e.details || {}),
                                e.user || 'system',
                                e.timestamp,
                                e.diff ? JSON.stringify(e.diff) : null
                            );
                        }
                    });
                    tx(rows);
                    logger.info(`Migrated ${rows.length} activity entries to SQLite`);
                } catch (e) {
                    logger.error(`Failed to migrate activity.json: ${e.message}`);
                }
            }
            this._markMigrated('activity.json');
        }

        if (!this._isMigrated('permissions.json')) {
            const p = path.join(config.dataDir, 'permissions.json');
            const permsCount = this.db.prepare('SELECT COUNT(*) as c FROM permissions_grants').get().c;
            if (fs.existsSync(p) && permsCount === 0) {
                try {
                    const grants = JSON.parse(fs.readFileSync(p, 'utf-8'));
                    const stmt = this.db.prepare(`
                        INSERT OR REPLACE INTO permissions_grants (server_id, username, permissions_json)
                        VALUES (?, ?, ?)
                    `);
                    const tx = this.db.transaction((obj) => {
                        for (const [serverId, users] of Object.entries(obj || {})) {
                            for (const [username, perms] of Object.entries(users || {})) {
                                stmt.run(serverId, username, JSON.stringify(perms || []));
                            }
                        }
                    });
                    tx(grants);
                    logger.info('Migrated permissions.json to SQLite');
                } catch (e) {
                    logger.error(`Failed to migrate permissions.json: ${e.message}`);
                }
            }
            this._markMigrated('permissions.json');
        }

        if (!this._isMigrated('scheduled-tasks.json')) {
            const p = path.join(config.dataDir, 'scheduled-tasks.json');
            const tasksCount = this.db.prepare('SELECT COUNT(*) as c FROM scheduled_tasks').get().c;
            if (fs.existsSync(p) && tasksCount === 0) {
                try {
                    const tasks = JSON.parse(fs.readFileSync(p, 'utf-8'));
                    const stmt = this.db.prepare(`
                        INSERT OR REPLACE INTO scheduled_tasks
                        (id, server_id, network_id, type, name, interval_minutes, command, enabled, created_at, last_run, next_run)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    const tx = this.db.transaction((items) => {
                        for (const t of items) {
                            stmt.run(
                                t.id,
                                t.serverId || null,
                                t.networkId || null,
                                t.type,
                                t.name,
                                t.intervalMinutes,
                                t.command || null,
                                t.enabled ? 1 : 0,
                                t.createdAt,
                                t.lastRun || null,
                                t.nextRun || null
                            );
                        }
                    });
                    tx(tasks);
                    logger.info(`Migrated ${tasks.length} scheduled tasks to SQLite`);
                } catch (e) {
                    logger.error(`Failed to migrate scheduled-tasks.json: ${e.message}`);
                }
            }
            this._markMigrated('scheduled-tasks.json');
        }

        if (!this._isMigrated('panel.json')) {
            const p = path.join(config.dataDir, 'panel.json');
            const usersCount = this.db.prepare('SELECT COUNT(*) as c FROM panel_users').get().c;
            if (fs.existsSync(p) && usersCount === 0) {
                try {
                    const panel = JSON.parse(fs.readFileSync(p, 'utf-8'));
                    const insertUser = this.db.prepare(`
                        INSERT OR REPLACE INTO panel_users
                        (username, password_hash, role, is_admin, created_at, two_factor_json)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `);

                    const admin = panel.admin || null;
                    if (admin?.username && admin?.passwordHash) {
                        insertUser.run(
                            admin.username,
                            admin.passwordHash,
                            'admin',
                            1,
                            admin.createdAt || null,
                            JSON.stringify(admin.twoFactor || null)
                        );
                    }

                    for (const user of panel.users || []) {
                        if (!user.username || !user.passwordHash) continue;
                        insertUser.run(
                            user.username,
                            user.passwordHash,
                            user.role || 'viewer',
                            0,
                            user.createdAt || null,
                            JSON.stringify(user.twoFactor || null)
                        );
                    }

                    this.db.prepare(`
                        INSERT OR REPLACE INTO panel_meta (key, value_json)
                        VALUES ('settings', ?)
                    `).run(JSON.stringify(panel.settings || {}));

                    logger.info('Migrated panel.json users/settings to SQLite');
                } catch (e) {
                    logger.error(`Failed to migrate panel.json: ${e.message}`);
                }
            }
            this._markMigrated('panel.json');
        }
    }

    // Activity
    insertActivity(entry) {
        this.db.prepare(`
            INSERT OR REPLACE INTO activity_log (id, action, details_json, user, timestamp, diff_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            entry.id,
            entry.action,
            JSON.stringify(entry.details || {}),
            entry.user || 'system',
            entry.timestamp,
            entry.diff ? JSON.stringify(entry.diff) : null
        );
    }

    listActivity() {
        const rows = this.db.prepare(`
            SELECT id, action, details_json, user, timestamp, diff_json
            FROM activity_log
            ORDER BY timestamp DESC
        `).all();
        return rows.map((r) => ({
            id: r.id,
            action: r.action,
            details: JSON.parse(r.details_json || '{}'),
            user: r.user,
            timestamp: r.timestamp,
            diff: r.diff_json ? JSON.parse(r.diff_json) : null
        }));
    }

    clearActivity() {
        this.db.prepare('DELETE FROM activity_log').run();
    }

    trimActivity(maxEntries) {
        this.db.prepare(`
            DELETE FROM activity_log
            WHERE id NOT IN (
                SELECT id FROM activity_log
                ORDER BY timestamp DESC
                LIMIT ?
            )
        `).run(maxEntries);
    }

    // Permissions
    loadPermissionsGrants() {
        const rows = this.db.prepare(`
            SELECT server_id, username, permissions_json
            FROM permissions_grants
        `).all();
        const grants = {};
        for (const r of rows) {
            if (!grants[r.server_id]) grants[r.server_id] = {};
            grants[r.server_id][r.username] = JSON.parse(r.permissions_json || '[]');
        }
        return grants;
    }

    savePermissionsGrants(grants) {
        const del = this.db.prepare('DELETE FROM permissions_grants');
        const ins = this.db.prepare(`
            INSERT INTO permissions_grants (server_id, username, permissions_json)
            VALUES (?, ?, ?)
        `);
        const tx = this.db.transaction((obj) => {
            del.run();
            for (const [serverId, users] of Object.entries(obj || {})) {
                for (const [username, perms] of Object.entries(users || {})) {
                    ins.run(serverId, username, JSON.stringify(perms || []));
                }
            }
        });
        tx(grants);
    }

    // Scheduled tasks
    loadScheduledTasks() {
        const rows = this.db.prepare(`
            SELECT id, server_id, network_id, type, name, interval_minutes, command, enabled, created_at, last_run, next_run
            FROM scheduled_tasks
            ORDER BY created_at ASC
        `).all();
        return rows.map((r) => ({
            id: r.id,
            serverId: r.server_id,
            networkId: r.network_id,
            type: r.type,
            name: r.name,
            intervalMinutes: r.interval_minutes,
            command: r.command,
            enabled: !!r.enabled,
            createdAt: r.created_at,
            lastRun: r.last_run,
            nextRun: r.next_run
        }));
    }

    saveScheduledTasks(tasks) {
        const del = this.db.prepare('DELETE FROM scheduled_tasks');
        const ins = this.db.prepare(`
            INSERT INTO scheduled_tasks
            (id, server_id, network_id, type, name, interval_minutes, command, enabled, created_at, last_run, next_run)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = this.db.transaction((items) => {
            del.run();
            for (const t of items) {
                ins.run(
                    t.id,
                    t.serverId || null,
                    t.networkId || null,
                    t.type,
                    t.name,
                    t.intervalMinutes,
                    t.command || null,
                    t.enabled ? 1 : 0,
                    t.createdAt,
                    t.lastRun || null,
                    t.nextRun || null
                );
            }
        });
        tx(tasks || []);
    }

    // Panel users/settings
    getAdminUser() {
        const row = this.db.prepare(`
            SELECT username, password_hash, role, is_admin, created_at, two_factor_json
            FROM panel_users
            WHERE is_admin = 1
            LIMIT 1
        `).get();
        if (!row) return null;
        return {
            username: row.username,
            passwordHash: row.password_hash,
            role: row.role,
            isAdmin: !!row.is_admin,
            createdAt: row.created_at,
            twoFactor: row.two_factor_json ? JSON.parse(row.two_factor_json) : undefined
        };
    }

    getUser(username) {
        const row = this.db.prepare(`
            SELECT username, password_hash, role, is_admin, created_at, two_factor_json
            FROM panel_users
            WHERE username = ?
            LIMIT 1
        `).get(username);
        if (!row) return null;
        return {
            username: row.username,
            passwordHash: row.password_hash,
            role: row.role,
            isAdmin: !!row.is_admin,
            createdAt: row.created_at,
            twoFactor: row.two_factor_json ? JSON.parse(row.two_factor_json) : undefined
        };
    }

    listUsers() {
        const rows = this.db.prepare(`
            SELECT username, password_hash, role, is_admin, created_at, two_factor_json
            FROM panel_users
            ORDER BY is_admin DESC, username ASC
        `).all();
        return rows.map((row) => ({
            username: row.username,
            passwordHash: row.password_hash,
            role: row.role,
            isAdmin: !!row.is_admin,
            createdAt: row.created_at,
            twoFactor: row.two_factor_json ? JSON.parse(row.two_factor_json) : undefined
        }));
    }

    createInitialAdmin(username, passwordHash, settings = {}) {
        this.db.prepare(`
            INSERT INTO panel_users (username, password_hash, role, is_admin, created_at, two_factor_json)
            VALUES (?, ?, 'admin', 1, ?, ?)
        `).run(username, passwordHash, new Date().toISOString(), JSON.stringify(null));

        this.db.prepare(`
            INSERT OR REPLACE INTO panel_meta (key, value_json)
            VALUES ('settings', ?)
        `).run(JSON.stringify(settings));
    }

    createUser(username, passwordHash, role = 'viewer') {
        this.db.prepare(`
            INSERT INTO panel_users (username, password_hash, role, is_admin, created_at, two_factor_json)
            VALUES (?, ?, ?, 0, ?, ?)
        `).run(username, passwordHash, role, new Date().toISOString(), JSON.stringify(null));
    }

    deleteUser(username) {
        this.db.prepare('DELETE FROM panel_users WHERE username = ? AND is_admin = 0').run(username);
    }

    updateUserRole(username, role) {
        this.db.prepare('UPDATE panel_users SET role = ? WHERE username = ? AND is_admin = 0').run(role, username);
    }

    updatePassword(username, passwordHash) {
        this.db.prepare('UPDATE panel_users SET password_hash = ? WHERE username = ?').run(passwordHash, username);
    }

    updateTwoFactor(username, twoFactor) {
        this.db.prepare('UPDATE panel_users SET two_factor_json = ? WHERE username = ?')
            .run(JSON.stringify(twoFactor || null), username);
    }

    getSettings() {
        const row = this.db.prepare(`SELECT value_json FROM panel_meta WHERE key = 'settings'`).get();
        return row ? JSON.parse(row.value_json || '{}') : {};
    }
}

function getSqliteStore() {
    if (!singleton) {
        singleton = new SqliteStore();
    }
    return singleton;
}

module.exports = { getSqliteStore };
