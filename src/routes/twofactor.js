// FortunaPanel - Two-Factor Authentication Routes
const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getManager(req) {
    return req.app.locals.twoFactorManager;
}

// GET /api/2fa/status - Check if 2FA is enabled for current user
router.get('/status', (req, res) => {
    const manager = getManager(req);
    const enabled = manager.isEnabled(req.user.username);
    res.json({ enabled });
});

// POST /api/2fa/setup - Generate a new TOTP secret and QR code
router.post('/setup', async (req, res) => {
    const manager = getManager(req);
    try {
        const result = await manager.generateQRCode(req.user.username);
        res.json({
            secret: result.secret,
            qrCode: result.qrDataUrl
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/2fa/verify - Verify code and enable 2FA
router.post('/verify', (req, res) => {
    const manager = getManager(req);
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Verification code required' });

    try {
        const result = manager.verifyAndEnable(req.user.username, code);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/2fa/disable - Disable 2FA
router.post('/disable', (req, res) => {
    const manager = getManager(req);
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Verification code required' });

    try {
        const result = manager.disable(req.user.username, code);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
