const fs = require('fs');
const path = require('path');
const config = require('../config/default');
const logger = require('../utils/logger');
const paperApi = require('../services/paperApi');
const mojangApi = require('../services/mojangApi');
const proxyApi = require('../services/proxyApi');
const JarDownloader = require('../services/jarDownloader');
const { extractZipBuffer } = require('../services/zipExtractor');
const { detectServerConfig } = require('../services/serverDetector');

// Descend up to 3 levels into an extracted archive to find the real server
// root (the directory that directly contains a .jar file).
function findServerRoot(root, depth = 0) {
    if (depth > 3) return null;
    try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        const hasJar = entries.some(e => e.isFile() && e.name.toLowerCase().endsWith('.jar'));
        if (hasJar) return root;
        const subdirs = entries.filter(e => e.isDirectory());
        if (subdirs.length === 1) {
            return findServerRoot(path.join(root, subdirs[0].name), depth + 1);
        }
        // Multiple subdirs — try each, but prefer the first that contains a jar
        for (const dir of subdirs) {
            const found = findServerRoot(path.join(root, dir.name), depth + 1);
            if (found) return found;
        }
    } catch (_) {}
    return null;
}

class JarManager {
    constructor() {
        this.downloader = new JarDownloader();
    }

    async getAvailableVersions(type) {
        switch (type) {
            case 'paper':
                return paperApi.getVersions();
            case 'vanilla':
                return mojangApi.getVersions(true);
            case 'velocity':
                return proxyApi.getVelocityVersions();
            case 'bungeecord':
                return proxyApi.getBungeeVersions();
            default:
                return [];
        }
    }

    async getBuilds(type, version) {
        if (type === 'paper') {
            const builds = await paperApi.getBuilds(version);
            return builds.map(b => ({
                build: b.build,
                channel: b.channel,
                time: b.time
            }));
        }
        if (type === 'velocity') {
            const builds = await proxyApi.getVelocityBuilds(version);
            return builds.map(b => ({
                build: b.build,
                channel: b.channel,
                time: b.time
            }));
        }
        if (type === 'bungeecord') {
            const build = await proxyApi.getBungeeLatestBuild();
            return [{ build: build.build, channel: 'default' }];
        }
        // Vanilla has no builds concept
        return [{ build: 'release', channel: 'default' }];
    }

    async downloadJar(type, version, build, onProgress) {
        let url, filename;

        if (type === 'paper') {
            const latestBuild = build
                ? (await paperApi.getBuilds(version)).find(b => b.build === build)
                : await paperApi.getLatestBuild(version);

            if (!latestBuild) throw new Error('Build not found');

            filename = latestBuild.downloads.application.name;
            url = paperApi.getDownloadUrl(version, latestBuild.build, filename);
        } else if (type === 'vanilla') {
            const serverInfo = await mojangApi.getServerDownloadUrl(version);
            url = serverInfo.url;
            filename = `server-${version}.jar`;
        } else if (type === 'velocity') {
            const latestBuild = build
                ? (await proxyApi.getVelocityBuilds(version)).find(b => b.build === build)
                : await proxyApi.getLatestVelocityBuild(version);

            if (!latestBuild) throw new Error('Build not found');

            filename = latestBuild.downloads.application.name;
            url = proxyApi.getVelocityDownloadUrl(version, latestBuild.build, filename);
        } else if (type === 'bungeecord') {
            url = proxyApi.getBungeeDownloadUrl();
            filename = 'BungeeCord.jar';
            version = 'latest';
        } else {
            throw new Error(`Unsupported server type: ${type}`);
        }

        const cacheDir = path.join(config.jarsCache, type, version);
        const cachePath = path.join(cacheDir, filename);

        // Check cache
        if (fs.existsSync(cachePath)) {
            logger.info(`JAR found in cache: ${cachePath}`);
            return { path: cachePath, filename, cached: true };
        }

        // Download
        if (onProgress) {
            this.downloader.on('progress', onProgress);
        }

        try {
            await this.downloader.download(url, cachePath, { type, version });
        } finally {
            if (onProgress) {
                this.downloader.removeListener('progress', onProgress);
            }
        }

        return { path: cachePath, filename, cached: false };
    }

    async uploadCustomJar(filename, buffer) {
        // Strip any directory components and reject traversal attempts so a
        // caller passing originalname="../../servers/victim/server.jar"
        // cannot overwrite arbitrary files.
        const base = path.basename(filename || '');
        if (!base || base === '.' || base === '..' || base !== filename) {
            throw new Error('Invalid filename');
        }
        if (!/^[A-Za-z0-9._-]+\.jar$/i.test(base)) {
            throw new Error('Filename must be a plain .jar name (letters, numbers, dot/dash/underscore)');
        }

        const customDir = path.resolve(path.join(config.jarsCache, 'custom'));
        if (!fs.existsSync(customDir)) {
            fs.mkdirSync(customDir, { recursive: true });
        }

        const destPath = path.resolve(customDir, base);
        const sep = path.sep;
        const withSep = customDir.endsWith(sep) ? customDir : customDir + sep;
        if (destPath !== customDir && !destPath.startsWith(withSep)) {
            throw new Error('Invalid path');
        }

        fs.writeFileSync(destPath, buffer);
        logger.info(`Custom JAR uploaded: ${base}`);

        return { path: destPath, filename: base };
    }

    /**
     * Extract an uploaded server archive (.zip) into a staging directory
     * under the data/jars/archive cache. Detect the server type/JAR so the
     * wizard can preview what was found before committing to a server.
     * Returns { directory, detected }.
     */
    async uploadServerZip(originalName, buffer) {
        const stagingRoot = path.join(config.jarsCache, 'archive');
        if (!fs.existsSync(stagingRoot)) {
            fs.mkdirSync(stagingRoot, { recursive: true });
        }

        const sanitized = path.basename(originalName, path.extname(originalName))
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .slice(0, 40) || 'archive';
        const stamp = Date.now().toString(36);
        const destDir = path.join(stagingRoot, `${sanitized}-${stamp}`);

        await extractZipBuffer(buffer, destDir);

        // If the zip contained nested server directories, walk down until we
        // find one that has a .jar file — makes the UX forgiving when users
        // upload a zip that wraps the server folder one or two levels deep.
        const effectiveDir = findServerRoot(destDir) || destDir;
        let detected = null;
        try {
            detected = detectServerConfig(effectiveDir);
        } catch (e) {
            detected = { type: 'unknown', jarFile: null, version: null };
        }

        if (!detected || !detected.jarFile) {
            // Clean up — useless upload
            try { fs.rmSync(destDir, { recursive: true, force: true }); } catch (_) {}
            throw new Error('No server JAR was found inside the uploaded archive');
        }

        logger.info(`Server archive extracted: ${originalName} -> ${effectiveDir} (${detected.type}, jar=${detected.jarFile})`);
        return { directory: effectiveDir, detected };
    }

    getCachedJars() {
        const jars = [];
        const types = ['paper', 'vanilla', 'velocity', 'bungeecord', 'custom'];

        for (const type of types) {
            const typeDir = path.join(config.jarsCache, type);
            if (!fs.existsSync(typeDir)) continue;

            if (type === 'custom') {
                const files = fs.readdirSync(typeDir);
                for (const file of files) {
                    if (file.endsWith('.jar')) {
                        const stat = fs.statSync(path.join(typeDir, file));
                        jars.push({ type, version: 'custom', filename: file, size: stat.size });
                    }
                }
            } else {
                const versions = fs.readdirSync(typeDir);
                for (const version of versions) {
                    const versionDir = path.join(typeDir, version);
                    if (!fs.statSync(versionDir).isDirectory()) continue;
                    const files = fs.readdirSync(versionDir);
                    for (const file of files) {
                        if (file.endsWith('.jar')) {
                            const stat = fs.statSync(path.join(versionDir, file));
                            jars.push({ type, version, filename: file, size: stat.size });
                        }
                    }
                }
            }
        }

        return jars;
    }

    getJarPath(type, version, filename) {
        if (type === 'custom') {
            return path.join(config.jarsCache, 'custom', filename);
        }
        return path.join(config.jarsCache, type, version, filename);
    }
}

module.exports = JarManager;
