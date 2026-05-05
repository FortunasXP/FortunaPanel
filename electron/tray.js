const { Tray, Menu, nativeImage, shell, app } = require('electron');
const path = require('path');

class FortunasTray {
    constructor(config, serverManager, windowManager) {
        this.config = config;
        this.serverManager = serverManager;
        this.windowManager = windowManager;
        this.tray = null;
    }

    create() {
        const iconPath = path.join(__dirname, 'icon.png');
        let icon;
        try {
            icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
        } catch {
            // Fallback: create a simple 16x16 icon
            icon = nativeImage.createEmpty();
        }

        this.tray = new Tray(icon);
        this.tray.setToolTip('FortunaPanel');
        this._rebuildMenu();

        // Double-click to show window
        this.tray.on('double-click', () => {
            this.windowManager.show();
        });

        // Rebuild menu when server status changes
        this.serverManager.on('status', () => this._rebuildMenu());
    }

    _rebuildMenu() {
        if (!this.tray) return;

        const serverItems = [];
        for (const [id, instance] of this.serverManager.servers) {
            const isRunning = instance.status === 'running';
            const isTransitioning = instance.status === 'starting' || instance.status === 'stopping';

            serverItems.push({
                label: `${instance.name}`,
                sublabel: instance.status,
                submenu: [
                    {
                        label: 'Start',
                        enabled: !isRunning && !isTransitioning,
                        click: () => this.serverManager.startServer(id).catch(() => {})
                    },
                    {
                        label: 'Stop',
                        enabled: isRunning,
                        click: () => this.serverManager.stopServer(id).catch(() => {})
                    },
                    {
                        label: 'Restart',
                        enabled: isRunning,
                        click: () => this.serverManager.restartServer(id).catch(() => {})
                    }
                ]
            });
        }

        const template = [
            {
                label: 'Open FortunaPanel',
                click: () => this.windowManager.show()
            },
            {
                label: 'Open in Browser',
                click: () => shell.openExternal(`http://localhost:${this.config.port}`)
            },
            { type: 'separator' },
        ];

        if (serverItems.length > 0) {
            template.push({
                label: 'Servers',
                submenu: serverItems
            });
            template.push({ type: 'separator' });
        }

        template.push({
            label: 'Start with Windows',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (menuItem) => {
                app.setLoginItemSettings({ openAtLogin: menuItem.checked });
            }
        });

        template.push({ type: 'separator' });

        template.push({
            label: 'Quit FortunaPanel',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        });

        this.tray.setContextMenu(Menu.buildFromTemplate(template));
    }

    destroy() {
        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
    }
}

module.exports = FortunasTray;
