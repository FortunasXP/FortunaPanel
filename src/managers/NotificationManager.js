const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../config/default');
const logger = require('../utils/logger');

const SETTINGS_PATH = path.join(config.dataDir, 'notifications.json');

class NotificationManager {
    constructor() {
        this.settings = {
            discord: {
                enabled: false,
                webhookUrl: '',
                events: {
                    serverStart: true,
                    serverStop: true,
                    serverCrash: true,
                    playerJoin: false,
                    playerLeave: false,
                    backupComplete: true,
                    scheduledTask: false
                }
            }
        };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(SETTINGS_PATH)) {
                const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
                this.settings = { ...this.settings, ...saved };
            }
        } catch (e) {
            logger.error(`Failed to load notification settings: ${e.message}`);
        }
    }

    _save() {
        try {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.settings, null, 2));
        } catch (e) {
            logger.error(`Failed to save notification settings: ${e.message}`);
        }
    }

    getSettings() {
        return { ...this.settings };
    }

    // Whitelisted event keys — only fields we know about are accepted.
    // Anything else in the incoming body is silently dropped.
    _ALLOWED_EVENTS = ['serverStart', 'serverStop', 'serverCrash', 'playerJoin', 'playerLeave', 'backupComplete', 'scheduledTask'];

    updateSettings(newSettings) {
        if (!newSettings || typeof newSettings !== 'object') return this.settings;
        const incoming = newSettings.discord || {};

        // Only accept the fields we expose. Avoids mass-assignment of
        // arbitrary keys (e.g. an attacker setting `__proto__` or future
        // internal fields).
        const next = {
            enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : this.settings.discord.enabled,
            webhookUrl: this.settings.discord.webhookUrl,
            events: { ...this.settings.discord.events }
        };

        // Webhook URL: must be a Discord webhook URL. Validate scheme and
        // host to prevent SSRF — the panel POSTs JSON with server names,
        // player names, etc., and the response body is logged on error.
        if (incoming.webhookUrl !== undefined) {
            const url = String(incoming.webhookUrl || '').trim();
            if (url === '') {
                next.webhookUrl = '';
            } else if (!NotificationManager._isAllowedWebhookUrl(url)) {
                throw new Error('Webhook URL must be a Discord webhook URL (https://discord.com/api/webhooks/...)');
            } else {
                next.webhookUrl = url;
            }
        }

        // Events: only known boolean keys. Drops everything else.
        if (incoming.events && typeof incoming.events === 'object') {
            for (const key of this._ALLOWED_EVENTS) {
                if (key in incoming.events) {
                    next.events[key] = !!incoming.events[key];
                }
            }
        }

        this.settings = { discord: next };
        this._save();
        return this.settings;
    }

    // Strict Discord-webhook allowlist. We do not currently support custom
    // webhook destinations; if/when we do, expand this with proper SSRF
    // protection (DNS resolution + private-range checks).
    static _isAllowedWebhookUrl(rawUrl) {
        let url;
        try { url = new URL(rawUrl); } catch (_) { return false; }
        if (url.protocol !== 'https:') return false;
        const host = url.hostname.toLowerCase();
        if (host !== 'discord.com' && host !== 'discordapp.com' && host !== 'canary.discord.com' && host !== 'ptb.discord.com') {
            return false;
        }
        if (!url.pathname.startsWith('/api/webhooks/')) return false;
        return true;
    }

    /**
     * Wire up to ServerManager and BackupManager events
     */
    attach(serverManager, backupManager) {
        serverManager.on('status', (data) => {
            if (data.status === 'running' && data.previousStatus === 'starting') {
                this.notify('serverStart', {
                    title: 'Server Started',
                    description: `Server **${this._getServerName(serverManager, data.serverId)}** is now online.`,
                    color: 0x22c55e
                });
            } else if (data.status === 'stopped') {
                const wasCrash = data.previousStatus === 'running';
                if (wasCrash) {
                    this.notify('serverCrash', {
                        title: 'Server Crashed',
                        description: `Server **${this._getServerName(serverManager, data.serverId)}** has stopped unexpectedly.`,
                        color: 0xef4444
                    });
                } else {
                    this.notify('serverStop', {
                        title: 'Server Stopped',
                        description: `Server **${this._getServerName(serverManager, data.serverId)}** has been stopped.`,
                        color: 0x71717a
                    });
                }
            }
        });

        serverManager.on('player-join', (data) => {
            this.notify('playerJoin', {
                title: 'Player Joined',
                description: `**${data.player}** joined **${this._getServerName(serverManager, data.serverId)}**`,
                color: 0x22c55e
            });
        });

        serverManager.on('player-leave', (data) => {
            this.notify('playerLeave', {
                title: 'Player Left',
                description: `**${data.player}** left **${this._getServerName(serverManager, data.serverId)}**`,
                color: 0xa1a1aa
            });
        });
    }

    /**
     * Send a notification for a specific event
     */
    notify(eventType, embed) {
        if (!this.settings.discord.enabled || !this.settings.discord.webhookUrl) return;
        if (!this.settings.discord.events[eventType]) return;

        this._sendDiscordWebhook({
            embeds: [{
                title: embed.title,
                description: embed.description,
                color: embed.color || 0xfafafa,
                timestamp: new Date().toISOString(),
                footer: { text: 'FortunaPanel' }
            }]
        }).catch(err => {
            logger.error(`Discord notification failed: ${err.message}`);
        });
    }

    /**
     * Send a test notification to verify webhook
     */
    async testWebhook(webhookUrl) {
        return this._sendDiscordWebhook({
            embeds: [{
                title: 'Test Notification',
                description: 'FortunaPanel webhook is working correctly!',
                color: 0x22c55e,
                timestamp: new Date().toISOString(),
                footer: { text: 'FortunaPanel' }
            }]
        }, webhookUrl);
    }

    _sendDiscordWebhook(payload, urlOverride = null) {
        const webhookUrl = urlOverride || this.settings.discord.webhookUrl;
        if (!webhookUrl) return Promise.reject(new Error('No webhook URL'));

        return new Promise((resolve, reject) => {
            const url = new URL(webhookUrl);
            const data = JSON.stringify(payload);

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const transport = url.protocol === 'https:' ? https : http;
            const req = transport.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ success: true });
                    } else {
                        reject(new Error(`Discord webhook returned ${res.statusCode}: ${body}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Webhook request timed out'));
            });

            req.write(data);
            req.end();
        });
    }

    _getServerName(serverManager, serverId) {
        const server = serverManager.getServer(serverId);
        return server ? server.name : serverId;
    }
}

module.exports = NotificationManager;
