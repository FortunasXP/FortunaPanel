const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

// Allowlist of hosts we trust to serve server jars. Prevents SSRF against
// internal services / metadata endpoints if an upstream API is compromised or
// a URL is manipulated. Matches exact host or *.suffix.
const ALLOWED_JAR_HOSTS = [
    'api.papermc.io',
    'fill.papermc.io',
    'piston-data.mojang.com',
    'launcher.mojang.com',
    'launchermeta.mojang.com',
    'meta.mojang.com',
    'repo.papermc.io',
    'download.getbukkit.org',
    'cdn.getbukkit.org',
    'media.forgecdn.net',
    'edge.forgecdn.net',
    'github.com',
    'objects.githubusercontent.com'
];

function isAllowedJarUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { return false; }
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (ALLOWED_JAR_HOSTS.includes(host)) return true;
    return ALLOWED_JAR_HOSTS.some(h => host.endsWith(`.${h}`));
}

class JarDownloader extends EventEmitter {
    async download(url, destPath, options = {}) {
        const maxRedirects = options._redirectsRemaining ?? 5;

        if (!isAllowedJarUrl(url)) {
            throw new Error(`Refusing to download from disallowed host: ${url}`);
        }

        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        logger.info(`Downloading: ${url}`);
        const res = await fetch(url, { redirect: 'manual' });

        // Follow redirects manually, re-validating each hop against the allowlist.
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            if (maxRedirects <= 0) {
                throw new Error('Too many redirects');
            }
            const next = new URL(res.headers.get('location'), url).toString();
            return this.download(next, destPath, { ...options, _redirectsRemaining: maxRedirects - 1 });
        }

        if (!res.ok) {
            throw new Error(`Download failed: ${res.status} ${res.statusText}`);
        }

        const contentLength = parseInt(res.headers.get('content-length') || '0');
        const writer = fs.createWriteStream(destPath);
        const reader = res.body.getReader();

        let downloaded = 0;
        let lastProgress = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            writer.write(Buffer.from(value));
            downloaded += value.length;

            if (contentLength > 0) {
                const progress = Math.floor((downloaded / contentLength) * 100);
                if (progress !== lastProgress) {
                    lastProgress = progress;
                    this.emit('progress', {
                        progress,
                        downloaded,
                        total: contentLength,
                        ...options
                    });
                }
            }
        }

        writer.end();
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        logger.info(`Download complete: ${destPath} (${downloaded} bytes)`);
        return { path: destPath, size: downloaded };
    }
}

module.exports = JarDownloader;
module.exports.isAllowedJarUrl = isAllowedJarUrl;
module.exports.ALLOWED_JAR_HOSTS = ALLOWED_JAR_HOSTS;
