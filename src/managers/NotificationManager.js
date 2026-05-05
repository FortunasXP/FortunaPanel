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

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this._save();
        return this.settings;
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
