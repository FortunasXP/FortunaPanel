const express = require('express');
const multer = require('multer');
const path = require('path');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');
const JarManager = require('../managers/JarManager');
const { asyncRoute, badRequest } = require('../utils/http');
const { requireString, requireEnum, requireNumber } = require('../utils/validation');

const router = express.Router();
router.use(authMiddleware);

const jarManager = new JarManager();

// Multer config for JAR uploads
const upload = multer({
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() === '.jar') {
            cb(null, true);
        } else {
            cb(new Error('Only .jar files are allowed'));
        }
    }
});

// Multer config for full-server zip uploads (larger cap, different extension)
const uploadZip = multer({
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() === '.zip') {
            cb(null, true);
        } else {
            cb(new Error('Only .zip archives are allowed'));
        }
    }
});

// GET /api/jars/types
router.get('/types', requireGlobalPermission('panel.read'), (req, res) => {
    res.json(['paper', 'vanilla', 'velocity', 'bungeecord', 'custom']);
});

// GET /api/jars/versions?type=paper
router.get('/versions', requireGlobalPermission('panel.read'), asyncRoute(async (req, res) => {
    const type = requireEnum(req.query.type, 'type', ['paper', 'vanilla', 'velocity', 'bungeecord', 'custom']);
    const versions = await jarManager.getAvailableVersions(type);
    res.json({ versions });
}));

// GET /api/jars/builds?type=paper&version=1.21.4
router.get('/builds', requireGlobalPermission('panel.read'), asyncRoute(async (req, res) => {
    const type = requireEnum(req.query.type, 'type', ['paper', 'vanilla', 'velocity', 'bungeecord', 'custom']);
    const version = requireString(req.query.version, 'version', { max: 64 });
    const builds = await jarManager.getBuilds(type, version);
    res.json({ builds });
}));

// POST /api/jars/download
router.post('/download', requireGlobalPermission('server.create'), asyncRoute(async (req, res) => {
    const type = requireEnum(req.body.type, 'type', ['paper', 'vanilla', 'velocity', 'bungeecord', 'custom']);
    const version = requireString(req.body.version, 'version', { max: 64 });
    const build = req.body.build === undefined || req.body.build === null || req.body.build === ''
        ? undefined
        : requireNumber(req.body.build, 'build', { integer: true, min: 1 });
    const asyncMode = req.query.async === '1' || req.body?.async === true;
    const jobManager = req.app.locals.jobManager;

    if (asyncMode && jobManager) {
        const job = jobManager.createJob({
            type: 'jar.download',
            name: `Download ${type} ${version}`,
            meta: { type, version, build: build || null },
            maxRetries: 1,
            run: async (ctx) => jarManager.downloadJar(type, version, build, (evt) => {
                ctx.update(evt.progress, `Downloading ${evt.progress}%`);
            })
        });
        return res.status(202).json({ jobId: job.id, status: job.status });
    }

    const result = await jarManager.downloadJar(type, version, build);
    res.json({
        success: true,
        filename: result.filename,
        path: result.path,
        cached: result.cached
    });
}));

// POST /api/jars/upload
router.post('/upload', requireGlobalPermission('server.create'), upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw badRequest('No file provided');

    const result = await jarManager.uploadCustomJar(req.file.originalname, req.file.buffer);
    res.json({ success: true, filename: result.filename, path: result.path });
}));

// POST /api/jars/upload-zip — extract a full server archive into a staging
// directory, detect the entry JAR, and return the info the wizard needs to
// complete step 2 of the create-server flow.
router.post('/upload-zip', requireGlobalPermission('server.create'), uploadZip.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) throw badRequest('No file provided');

    const result = await jarManager.uploadServerZip(req.file.originalname, req.file.buffer);
    res.json({
        success: true,
        directory: result.directory,
        detected: {
            type: result.detected.type,
            jarFile: result.detected.jarFile,
            version: result.detected.version,
            port: result.detected.port,
            motd: result.detected.motd,
            maxPlayers: result.detected.maxPlayers,
            isProxy: !!result.detected.isProxy
        }
    });
}));

// GET /api/jars/cached
router.get('/cached', requireGlobalPermission('panel.read'), (req, res) => {
    res.json(jarManager.getCachedJars());
});

module.exports = router;
