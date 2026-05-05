const { app, BrowserWindow, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Force dark mode for all native UI controls (select dropdowns, scrollbars, etc.)
nativeTheme.themeSource = 'dark';

// CRITICAL: Set working directory to app root before any app code loads.
// This ensures path.resolve('./servers') and path.resolve('./data') in
// src/config/default.js resolve correctly when running from source.
const APP_ROOT = app.isPackaged
    ? path.dirname(process.execPath)
    : path.join(__dirname, '..');
process.chdir(APP_ROOT);

// In a packaged build the install dir may be read-only or contain bundled
// resources we shouldn't write into. Route persistent data, server files, and
// logs to Electron's userData path instead (writable, per-user, OS-standard:
// %APPDATA%/FortunaPanel on Windows). Set env vars BEFORE requiring config so
// src/config/default.js sees them.
if (app.isPackaged) {
    const userData = app.getPath('userData');
    const dataDir = path.join(userData, 'data');
    const serversDir = path.join(userData, 'servers');
    const logsDir = path.join(userData, 'logs');
    try {
        for (const d of [dataDir, serversDir, logsDir]) {
            fs.mkdirSync(d, { recursive: true });
        }

        // Seed bundled JSON defaults on first run only — never overwrite the
        // user's modified copy. extraResources places templates in
        // resources/data/.
        const bundledData = path.join(process.resourcesPath, 'data');
        if (fs.existsSync(bundledData)) {
            for (const entry of fs.readdirSync(bundledData)) {
                if (!entry.endsWith('.json')) continue;
                const dest = path.join(dataDir, entry);
                if (!fs.existsSync(dest)) {
                    try { fs.copyFileSync(path.join(bundledData, entry), dest); } catch (_) {}
                }
            }
        }
    } catch (e) {
        dialog.showErrorBox('FortunaPanel Error',
            `Could not create user data directories under:\n${userData}\n\n${e.message}`);
        app.quit();
        return;
    }
    process.env.DATA_DIR = dataDir;
    process.env.SERVERS_ROOT = serversDir;
    process.env.LOGS_DIR = logsDir;
}

const config = require('../src/config/default');
const FortunasTray = require('./tray');

let mainWindow = null;
let tray = null;
let serverStarted = false;
let expressServer = null;
let serverManager = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    return;
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

async function startExpressServer() {
    const panel = require('../src/index');
    expressServer = panel.server;
    serverManager = panel.serverManager;

    // Call start() explicitly (Electron skips auto-start in index.js)
    await panel.start();

    // Wait for HTTP server to be listening
    if (!expressServer.listening) {
        await new Promise((resolve, reject) => {
            expressServer.on('listening', resolve);
            expressServer.on('error', reject);
            setTimeout(() => reject(new Error('Server start timeout (30s)')), 30000);
        });
    }

    serverStarted = true;
}

function createWindow() {
    const iconPath = path.join(__dirname, 'icon.png');

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        icon: iconPath,
        title: 'FortunaPanel',
        autoHideMenuBar: true,
        show: false,
        backgroundColor: '#0a0a0a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    mainWindow.loadURL(`http://localhost:${config.port}`);

    // Show when ready to prevent white flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Close to tray instead of quitting
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

app.on('ready', async () => {
    try {
        await startExpressServer();
    } catch (err) {
        dialog.showErrorBox('FortunaPanel Error',
            `Failed to start server:\n\n${err.message}`);
        app.quit();
        return;
    }

    // Create system tray
    const windowManager = {
        show: () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            } else {
                createWindow();
            }
        }
    };

    tray = new FortunasTray(config, serverManager, windowManager);
    tray.create();

    createWindow();
});

app.on('window-all-closed', () => {
    // Do NOT quit — keep running in tray
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Graceful shutdown
app.on('before-quit', async (event) => {
    if (serverStarted) {
        event.preventDefault();
        serverStarted = false; // prevent re-entry

        const logger = require('../src/utils/logger');
        logger.info('Electron shutting down FortunaPanel...');

        try {
            const expressApp = require('../src/index').app;
            const healthMonitor = expressApp.locals.healthMonitor;
            const statsCollector = expressApp.locals.statsCollector;
            const scheduler = expressApp.locals.scheduler;
            const resourceLimiter = expressApp.locals.resourceLimiter;
            const sftpServer = expressApp.locals.sftpServer;

            if (healthMonitor) healthMonitor.stop();
            if (statsCollector) statsCollector.stop();
            if (scheduler) scheduler.stop();
            if (resourceLimiter) resourceLimiter.stop();
            if (sftpServer) sftpServer.stop();

            await serverManager.shutdownAll();
        } catch (e) {
            logger.error(`Shutdown error: ${e.message}`);
        }

        if (tray) tray.destroy();

        if (expressServer) {
            expressServer.close(() => {
                app.quit();
            });
            // Force quit after 10 seconds
            setTimeout(() => app.exit(0), 10000);
        } else {
            app.quit();
        }
    }
});
