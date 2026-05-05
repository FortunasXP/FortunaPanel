// FortunaPanel - Granular Per-Server Permission Manager
const fs = require('fs');
const path = require('path');
const config = require('../config/default');
const logger = require('../utils/logger');
const { getSqliteStore } = require('../db/sqlite');
const UserStore = require('./UserStore');

const PERMISSIONS_PATH = path.join(config.dataDir, 'permissions.json');

// All available permissions
const PERMISSIONS = {
    // Server Control
    'panel.read': 'View panel-wide data',
    'panel.settings': 'Change panel-wide settings',
    'panel.users': 'Manage panel users',
    'panel.keys': 'Manage API keys',
    'panel.activity': 'View and manage panel activity logs',

    // Server Control
    'server.start': 'Start the server',
    'server.stop': 'Stop the server',
    'server.restart': 'Restart the server',
    'server.kill': 'Force kill the server',
    'server.command': 'Send console commands',
    'server.console': 'View server console',

    // Server Config
    'server.create': 'Create new servers',
    'server.settings': 'Modify server settings (name, memory, JVM args)',
    'server.properties': 'Edit server.properties',
    'server.startup': 'Modify startup variables',

    // Files
    'file.read': 'Browse and read files',
    'file.write': 'Create and edit files',
    'file.delete': 'Delete files',
    'file.sftp': 'Access SFTP',

    // Players
    'player.list': 'View player list',
    'player.kick': 'Kick players',
    'player.ban': 'Ban/unban players',
    'player.whitelist': 'Manage whitelist',

    // Backups
    'backup.create': 'Create backups',
    'backup.restore': 'Restore backups',
    'backup.delete': 'Delete backups',

    // Plugins
    'plugin.list': 'View installed plugins',
    'plugin.install': 'Upload/install plugins',
    'plugin.toggle': 'Enable/disable plugins',
    'plugin.delete': 'Delete plugins',

    // Schedule
    'schedule.view': 'View scheduled tasks',
    'schedule.manage': 'Create/edit/delete tasks',

    // Admin only
    'server.delete': 'Delete the server',
    'server.reinstall': 'Reinstall the server',
    'server.suspend': 'Suspend/unsuspend the server',
    'user.manage': 'Manage subusers for this server'
};

// Role presets
const ROLE_PRESETS = {
    admin: Object.keys(PERMISSIONS),
    operator: [
        'panel.read', 'panel.activity',
        'server.start', 'server.stop', 'server.restart', 'server.command', 'server.console',
        'server.create', 'server.settings', 'server.properties', 'server.startup',
        'file.read', 'file.write', 'file.delete', 'file.sftp',
        'player.list', 'player.kick', 'player.ban', 'player.whitelist',
        'backup.create', 'backup.restore', 'backup.delete',
        'plugin.list', 'plugin.install', 'plugin.toggle', 'plugin.delete',
        'schedule.view', 'schedule.manage'
    ],
    viewer: [
        'panel.read',
        'server.console', 'file.read', 'player.list', 'plugin.list',
        'schedule.view', 'backup.create'
    ]
};

class PermissionManager {
    constructor() {
        this.grants = {};   // { serverId: { username: [permissions] } }
        this.store = getSqliteStore();
        this.userStore = new UserStore();
        this.load();
    }

    load() {
        if (this.store.enabled) {
            try {
                this.grants = this.store.loadPermissionsGrants();
                return;
            } catch (e) {
                logger.error(`Failed to load permissions from SQLite: ${e.message}`);
            }
        }
        try {
            if (fs.existsSync(PERMISSIONS_PATH)) {
                this.grants = JSON.parse(fs.readFileSync(PERMISSIONS_PATH, 'utf-8'));
            }
        } catch (e) {
            logger.error(`Failed to load permissions: ${e.message}`);
            this.grants = {};
        }
    }

    save() {
        if (this.store.enabled) {
            this.store.savePermissionsGrants(this.grants);
            return;
        }
        fs.writeFileSync(PERMISSIONS_PATH, JSON.stringify(this.grants, null, 2));
    }

    // Check if user has permission for a server action
    hasPermission(username, serverId, permission) {
        // Panel admin has all permissions everywhere
        const admin = this.userStore.getAdmin();
        if (admin?.username === username) return true;

        // Check role-based global permissions
        const user = this.userStore.getUser(username);
        if (user) {
            const rolePerms = ROLE_PRESETS[user.role] || ROLE_PRESETS.viewer;
            // Admins get all perms
            if (user.role === 'admin') return true;

            // Check per-server grants first (override role defaults)
            const serverGrants = this.grants[serverId];
            if (serverGrants && serverGrants[username]) {
                return serverGrants[username].includes(permission) || serverGrants[username].includes('*');
            }

            // Fall back to role defaults
            return rolePerms.includes(permission);
        }

        return false;
    }

    // Set permissions for a user on a specific server
    setPermissions(serverId, username, permissions) {
        if (!this.grants[serverId]) {
            this.grants[serverId] = {};
        }
        this.grants[serverId][username] = permissions;
        this.save();
        logger.info(`Permissions set for ${username} on server ${serverId}: ${permissions.length} perms`);
    }

    // Get permissions for a user on a specific server
    getPermissions(serverId, username) {
        // Check admin
        const admin = this.userStore.getAdmin();
        if (admin?.username === username) {
            return Object.keys(PERMISSIONS);
        }

        // Check per-server grants
        const serverGrants = this.grants[serverId];
        if (serverGrants && serverGrants[username]) {
            return serverGrants[username];
        }

        // Fall back to role defaults
        const user = this.userStore.getUser(username);
        if (user) {
            return ROLE_PRESETS[user.role] || ROLE_PRESETS.viewer;
        }

        return [];
    }

    // Get all subusers for a server (with their permissions)
    getServerSubusers(serverId) {
        const serverGrants = this.grants[serverId] || {};
        const result = [];

        // Get all non-admin users
        const users = this.userStore.listUsers().filter(u => !u.isAdmin);
        for (const user of users) {
            const perms = serverGrants[user.username] || ROLE_PRESETS[user.role] || [];
            result.push({
                username: user.username,
                role: user.role,
                permissions: perms,
                hasCustomPermissions: !!serverGrants[user.username]
            });
        }

        return result;
    }

    // Remove user permissions for a server (revert to role defaults)
    removePermissions(serverId, username) {
        if (this.grants[serverId]) {
            delete this.grants[serverId][username];
            if (Object.keys(this.grants[serverId]).length === 0) {
                delete this.grants[serverId];
            }
            this.save();
        }
    }

    // Remove all permissions for a server (when server is deleted)
    removeServerPermissions(serverId) {
        delete this.grants[serverId];
        this.save();
    }

    // Get all available permissions with descriptions
    getAllPermissions() {
        return PERMISSIONS;
    }

    // Get role presets
    getRolePresets() {
        return ROLE_PRESETS;
    }
}

module.exports = PermissionManager;
