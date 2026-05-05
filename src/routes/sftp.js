// FortunaPanel - SFTP Status Routes
const express = require('express');
const { authMiddleware, requireGlobalPermission } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getSFTP(req) {
    return req.app.locals.sftpServer;
}

// GET /api/sftp/status - Get SFTP server status
router.get('/status', requireGlobalPermission('panel.read'), (req, res) => {
    const sftp = getSFTP(req);
    if (!sftp) return res.json({ running: false, port: 0, connections: 0, activeConnections: [] });
    res.json(sftp.getStatus());
});

module.exports = router;
