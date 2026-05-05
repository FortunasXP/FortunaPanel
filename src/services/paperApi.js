const logger = require('../utils/logger');

const BASE_URL = 'https://api.papermc.io/v2/projects/paper';

async function getVersions() {
    const res = await fetch(BASE_URL);
    if (!res.ok) throw new Error(`PaperMC API error: ${res.status}`);
    const data = await res.json();
    // Return versions in descending order (newest first)
    return data.versions.reverse();
}

async function getBuilds(version) {
    const res = await fetch(`${BASE_URL}/versions/${version}/builds`);
    if (!res.ok) throw new Error(`PaperMC API error: ${res.status}`);
    const data = await res.json();
    return data.builds;
}

async function getLatestBuild(version) {
    const builds = await getBuilds(version);
    // Get the latest build with channel "default" (stable)
    const stable = builds.filter(b => b.channel === 'default');
    return stable.length > 0 ? stable[stable.length - 1] : builds[builds.length - 1];
}

function getDownloadUrl(version, build, filename) {
    return `${BASE_URL}/versions/${version}/builds/${build}/downloads/${filename}`;
}

module.exports = { getVersions, getBuilds, getLatestBuild, getDownloadUrl };
