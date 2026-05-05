const logger = require('../utils/logger');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

let cachedManifest = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getManifest() {
    if (cachedManifest && Date.now() - cacheTime < CACHE_TTL) {
        return cachedManifest;
    }

    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`Mojang API error: ${res.status}`);
    cachedManifest = await res.json();
    cacheTime = Date.now();
    return cachedManifest;
}

async function getVersions(releasesOnly = true) {
    const manifest = await getManifest();
    const versions = manifest.versions;

    if (releasesOnly) {
        return versions.filter(v => v.type === 'release').map(v => v.id);
    }

    return versions.map(v => ({ id: v.id, type: v.type }));
}

async function getServerDownloadUrl(versionId) {
    const manifest = await getManifest();
    const version = manifest.versions.find(v => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const res = await fetch(version.url);
    if (!res.ok) throw new Error(`Failed to fetch version details: ${res.status}`);
    const data = await res.json();

    if (!data.downloads || !data.downloads.server) {
        throw new Error(`No server download available for ${versionId}`);
    }

    return {
        url: data.downloads.server.url,
        sha1: data.downloads.server.sha1,
        size: data.downloads.server.size
    };
}

module.exports = { getVersions, getServerDownloadUrl };
