// FortunaPanel - Modrinth API Integration
// Search and download plugins/mods from Modrinth
const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const BASE_URL = 'https://api.modrinth.com/v2';
const USER_AGENT = 'FortunaPanel/1.0 (https://github.com/fortuna)';

function request(endpoint) {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}${endpoint}`;
        const options = {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 400) {
                        reject(new Error(`Modrinth API error: ${res.statusCode}`));
                        return;
                    }
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid response from Modrinth'));
                }
            });
        }).on('error', reject);
    });
}

async function searchPlugins(query, gameVersion, platform) {
    // Build facets for filtering
    const facets = [];

    // Project type: plugin or mod
    if (platform === 'paper' || platform === 'spigot' || platform === 'bukkit') {
        facets.push(['project_type:plugin', 'project_type:mod']);
        facets.push([`categories:${platform}`, 'categories:bukkit', 'categories:spigot', 'categories:paper']);
    } else if (platform === 'forge') {
        facets.push(['project_type:mod']);
        facets.push(['categories:forge']);
    } else if (platform === 'fabric') {
        facets.push(['project_type:mod']);
        facets.push(['categories:fabric']);
    } else {
        facets.push(['project_type:plugin', 'project_type:mod']);
    }

    if (gameVersion) {
        facets.push([`versions:${gameVersion}`]);
    }

    const params = new URLSearchParams({
        query: query || '',
        limit: '20',
        facets: JSON.stringify(facets)
    });

    const data = await request(`/search?${params}`);

    return (data.hits || []).map(hit => ({
        id: hit.project_id,
        slug: hit.slug,
        name: hit.title,
        description: hit.description,
        author: hit.author,
        downloads: hit.downloads,
        iconUrl: hit.icon_url,
        categories: hit.categories || [],
        projectType: hit.project_type,
        dateModified: hit.date_modified
    }));
}

async function getProjectVersions(projectId, gameVersion, loaders) {
    let endpoint = `/project/${projectId}/version`;
    const params = new URLSearchParams();

    if (gameVersion) {
        params.set('game_versions', JSON.stringify([gameVersion]));
    }
    if (loaders && loaders.length > 0) {
        params.set('loaders', JSON.stringify(loaders));
    }

    const paramStr = params.toString();
    if (paramStr) endpoint += `?${paramStr}`;

    const versions = await request(endpoint);

    return versions.map(v => ({
        id: v.id,
        name: v.name,
        versionNumber: v.version_number,
        gameVersions: v.game_versions,
        loaders: v.loaders,
        datePublished: v.date_published,
        files: (v.files || []).map(f => ({
            filename: f.filename,
            url: f.url,
            size: f.size,
            primary: f.primary
        }))
    }));
}

// Allowed origins for plugin downloads. Re-validated on every redirect to
// prevent SSRF via a trusted CDN that 30x's to an internal/metadata IP.
const ALLOWED_DOWNLOAD_ORIGINS = [
    'https://cdn.modrinth.com/',
    'https://mediafilez.forgecdn.net/'
];

function isAllowedDownloadUrl(url) {
    if (typeof url !== 'string') return false;
    return ALLOWED_DOWNLOAD_ORIGINS.some(o => url.startsWith(o));
}

function downloadPlugin(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        let redirectCount = 0;
        const MAX_REDIRECTS = 5;

        const cleanupAndReject = (err) => {
            try { file.close(); } catch (_) {}
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(err);
        };

        const doDownload = (downloadUrl) => {
            if (!isAllowedDownloadUrl(downloadUrl)) {
                cleanupAndReject(new Error('Refusing to download from non-allowlisted origin'));
                return;
            }

            https.get(downloadUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
                // Follow redirects, but re-validate against the allowlist
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    if (++redirectCount > MAX_REDIRECTS) {
                        cleanupAndReject(new Error('Too many redirects'));
                        return;
                    }
                    const next = res.headers.location;
                    if (!next) {
                        cleanupAndReject(new Error('Redirect with no Location header'));
                        return;
                    }
                    // Resolve relative redirects against the current URL
                    let absolute;
                    try { absolute = new URL(next, downloadUrl).toString(); }
                    catch (_) { cleanupAndReject(new Error('Invalid redirect target')); return; }
                    res.resume(); // drain
                    doDownload(absolute);
                    return;
                }
                if (res.statusCode !== 200) {
                    cleanupAndReject(new Error(`Download failed: HTTP ${res.statusCode}`));
                    return;
                }
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(destPath);
                });
            }).on('error', cleanupAndReject);
        };
        doDownload(url);
    });
}

module.exports = { searchPlugins, getProjectVersions, downloadPlugin };
