const fs = require('fs');
const path = require('path');
const config = require('../config/default');
const { getSqliteStore } = require('../db/sqlite');

const PANEL_CONFIG_PATH = path.join(config.dataDir, 'panel.json');

class UserStore {
    constructor() {
        this.store = getSqliteStore();
    }

    _loadPanelConfig() {
        if (!fs.existsSync(PANEL_CONFIG_PATH)) return null;
        return JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf-8'));
    }

    _savePanelConfig(panelConfig) {
        fs.writeFileSync(PANEL_CONFIG_PATH, JSON.stringify(panelConfig, null, 2));
    }

    isSetup() {
        if (this.store.enabled) {
            return !!this.store.getAdminUser();
        }
        const panel = this._loadPanelConfig();
        return !!panel?.admin;
    }

    getAdmin() {
        if (this.store.enabled) {
            return this.store.getAdminUser();
        }
        const panel = this._loadPanelConfig();
        if (!panel?.admin) return null;
        return {
            username: panel.admin.username,
            passwordHash: panel.admin.passwordHash,
            role: 'admin',
            isAdmin: true,
            createdAt: panel.admin.createdAt || null,
            twoFactor: panel.admin.twoFactor
        };
    }

    getUser(username) {
        if (this.store.enabled) {
            return this.store.getUser(username);
        }
        const panel = this._loadPanelConfig();
        if (!panel?.admin) return null;
        if (panel.admin.username === username) {
            return {
                username: panel.admin.username,
                passwordHash: panel.admin.passwordHash,
                role: 'admin',
                isAdmin: true,
                createdAt: panel.admin.createdAt || null,
                twoFactor: panel.admin.twoFactor
            };
        }
        const user = (panel.users || []).find(u => u.username === username);
        if (!user) return null;
        return {
            username: user.username,
            passwordHash: user.passwordHash,
            role: user.role,
            isAdmin: false,
            createdAt: user.createdAt || null,
            twoFactor: user.twoFactor
        };
    }

    listUsers() {
        if (this.store.enabled) {
            return this.store.listUsers();
        }
        const panel = this._loadPanelConfig();
        if (!panel?.admin) return [];
        const users = [{
            username: panel.admin.username,
            passwordHash: panel.admin.passwordHash,
            role: 'admin',
            isAdmin: true,
            createdAt: panel.admin.createdAt || null,
            twoFactor: panel.admin.twoFactor
        }];
        for (const u of panel.users || []) {
            users.push({
                username: u.username,
                passwordHash: u.passwordHash,
                role: u.role,
                isAdmin: false,
                createdAt: u.createdAt || null,
                twoFactor: u.twoFactor
            });
        }
        return users;
    }

    createInitialAdmin(username, passwordHash) {
        if (this.store.enabled) {
            this.store.createInitialAdmin(username, passwordHash, {
                serversRoot: config.serversRoot,
                javaPath: config.defaultJavaPath,
                panelPort: config.port
            });
            return;
        }
        const panelConfig = {
            admin: { username, passwordHash },
            settings: {
                serversRoot: config.serversRoot,
                javaPath: config.defaultJavaPath,
                panelPort: config.port
            }
        };
        this._savePanelConfig(panelConfig);
    }

    createUser(username, passwordHash, role = 'viewer') {
        if (this.store.enabled) {
            this.store.createUser(username, passwordHash, role);
            return;
        }
        const panel = this._loadPanelConfig();
        if (!panel.users) panel.users = [];
        panel.users.push({ username, passwordHash, role, createdAt: new Date().toISOString() });
        this._savePanelConfig(panel);
    }

    deleteUser(username) {
        if (this.store.enabled) {
            this.store.deleteUser(username);
            return;
        }
        const panel = this._loadPanelConfig();
        panel.users = (panel.users || []).filter(u => u.username !== username);
        this._savePanelConfig(panel);
    }

    updateUserRole(username, role) {
        if (this.store.enabled) {
            this.store.updateUserRole(username, role);
            return;
        }
        const panel = this._loadPanelConfig();
        const user = (panel.users || []).find(u => u.username === username);
        if (user) {
            user.role = role;
            this._savePanelConfig(panel);
        }
    }

    updatePassword(username, passwordHash) {
        if (this.store.enabled) {
            this.store.updatePassword(username, passwordHash);
            return;
        }
        const panel = this._loadPanelConfig();
        if (panel.admin?.username === username) {
            panel.admin.passwordHash = passwordHash;
        } else {
            const user = (panel.users || []).find(u => u.username === username);
            if (user) user.passwordHash = passwordHash;
        }
        this._savePanelConfig(panel);
    }

    updateTwoFactor(username, twoFactor) {
        if (this.store.enabled) {
            this.store.updateTwoFactor(username, twoFactor);
            return;
        }
        const panel = this._loadPanelConfig();
        if (panel.admin?.username === username) {
            panel.admin.twoFactor = twoFactor;
        } else {
            const user = (panel.users || []).find(u => u.username === username);
            if (user) user.twoFactor = twoFactor;
        }
        this._savePanelConfig(panel);
    }
}

module.exports = UserStore;
