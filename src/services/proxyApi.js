const logger = require('../utils/logger');

// Velocity uses the same PaperMC API infrastructure
const VELOCITY_BASE = 'https://api.papermc.io/v2/projects/velocity';

// BungeeCord uses Jenkins CI
const BUNGEE_BASE = 'https://ci.md-5.net/job/BungeeCord';

// --- Velocity ---

async function getVelocityVersions() {
    const res = await fetch(VELOCITY_BASE);
    if (!res.ok) throw new Error(`Velocity API error: ${res.status}`);
    const data = await res.json();
    return data.versions.reverse();
}

async function getVelocityBuilds(version) {
    const res = await fetch(`${VELOCITY_BASE}/versions/${version}/builds`);
    if (!res.ok) throw new Error(`Velocity API error: ${res.status}`);
    const data = await res.json();
    return data.builds;
}

async function getLatestVelocityBuild(version) {
    const builds = await getVelocityBuilds(version);
    const stable = builds.filter(b => b.channel === 'default');
    return stable.length > 0 ? stable[stable.length - 1] : builds[builds.length - 1];
}

function getVelocityDownloadUrl(version, build, filename) {
    return `${VELOCITY_BASE}/versions/${version}/builds/${build}/downloads/${filename}`;
}

// --- BungeeCord ---

async function getBungeeLatestBuild() {
    const res = await fetch(`${BUNGEE_BASE}/lastSuccessfulBuild/api/json`);
    if (!res.ok) throw new Error(`BungeeCord API error: ${res.status}`);
    const data = await res.json();
    return {
        build: data.number,
        timestamp: data.timestamp,
        url: data.url
    };
}

function getBungeeDownloadUrl() {
    return `${BUNGEE_BASE}/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar`;
}

async function getBungeeVersions() {
    // BungeeCord doesn't have a version concept — there's one latest build
    // Return a single "latest" entry
    try {
        const build = await getBungeeLatestBuild();
        return [`latest (build #${build.build})`];
    } catch {
        return ['latest'];
    }
}

module.exports = {
    getVelocityVersions,
    getVelocityBuilds,
    getLatestVelocityBuild,
    getVelocityDownloadUrl,
    getBungeeLatestBuild,
    getBungeeDownloadUrl,
    getBungeeVersions
};
