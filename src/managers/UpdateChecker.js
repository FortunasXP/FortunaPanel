const https = require('https');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const config = require('../config/default');
const logger = require('../utils/logger');

const CACHE_PATH = path.join(config.dataDir, 'update-check.json');
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // Check every 6 hours
const REPO_OWNER = 'FortunasXP';
const REPO_NAME = 'FortunaPanel';

class UpdateChecker extends EventEmitter {
    constructor() {
        super();
        this._interval = null;
        this._currentVersion = require('../../package.json').version;
        this._latest = null;
        this._lastCheck = null;
        this._dismissed = null;
        this._load();
    }

    get currentVersion() {
        return this._currentVersion;
    }

    get latestVersion() {
        return this._latest?.version || null;
    }

    get updateAvailable() {
        if (!this._latest?.version) return false;
        if (this._dismissed === this._latest.version) return false;
        return this._compareVersions(this._latest.version, this._currentVersion) > 0;
    }

    getStatus() {
        return {
            currentVersion: this._currentVersion,
            latestVersion: this._latest?.version || null,
            updateAvailable: this.updateAvailable,
            releaseUrl: this._latest?.url || null,
            releaseName: this._latest?.name || null,
            publishedAt: this._latest?.publishedAt || null,
            lastCheck: this._lastCheck,
            dismissed: this._dismissed
        };
    }

    start() {
        // Check immediately if stale (> 6 hours since last check)
        const stale = !this._lastCheck || (Date.now() - this._lastCheck > CHECK_INTERVAL);
        if (stale) {
            this.check().catch(() => {});
        }

        this._interval = setInterval(() => {
            this.check().catch(() => {});
        }, CHECK_INTERVAL);

        logger.info(`Update checker started (current: v${this._currentVersion})`);
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    async check() {
        try {
            const release = await this._fetchLatestRelease();
            if (!release) return;

            const version = release.tag_name.replace(/^v/, '');
            const wasNew = this._latest?.version !== version &&
                this._compareVersions(version, this._currentVersion) > 0;

            this._latest = {
                version,
                url: release.html_url,
                name: release.name || `v${version}`,
                publishedAt: release.published_at
            };
            this._lastCheck = Date.now();
            this._save();

            if (wasNew) {
                logger.info(`New version available: v${version} (current: v${this._currentVersion})`);
                this.emit('update-available', this.getStatus());
            }

            return this.getStatus();
        } catch (err) {
            logger.warn(`Update check failed: ${err.message}`);
            throw err;
        }
    }

    dismiss(version) {
        this._dismissed = version || this._latest?.version;
        this._save();
    }

    _fetchLatestRelease() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
                method: 'GET',
                headers: {
                    'User-Agent': `FortunaPanel/${this._currentVersion}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Invalid JSON from GitHub API'));
                        }
                    } else if (res.statusCode === 404) {
                        resolve(null); // No releases yet
                    } else {
                        reject(new Error(`GitHub API responded with ${res.statusCode}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
            req.end();
        });
    }

    /**
     * Compare two semver strings. Returns:
     *  1 if a > b, -1 if a < b, 0 if equal
     */
    _compareVersions(a, b) {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            const na = pa[i] || 0;
            const nb = pb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    }

    _load() {
        try {
            if (fs.existsSync(CACHE_PATH)) {
                const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
                this._latest = data.latest || null;
                this._lastCheck = data.lastCheck || null;
                this._dismissed = data.dismissed || null;
            }
        } catch (e) {
            // Ignore corrupt cache
        }
    }

    _save() {
        try {
            fs.writeFileSync(CACHE_PATH, JSON.stringify({
                latest: this._latest,
                lastCheck: this._lastCheck,
                dismissed: this._dismissed
            }, null, 2));
        } catch (e) {
            logger.warn(`Failed to save update cache: ${e.message}`);
        }
    }
}

module.exports = UpdateChecker;
