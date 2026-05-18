// FortunaPanel - Settings Page
import { api } from '../api.js';
import { showToast, showModal, escapeHtml, safeHref } from '../app.js';

export function breadcrumbs() {
    return [{ label: 'Settings', href: '/settings' }];
}

export async function render(container) {
    let notifSettings = null;
    try {
        notifSettings = await api.get('/notifications/settings');
    } catch (e) {}

    container.innerHTML = `
        <section class="settings-section">
        <div class="flex w-full flex-col gap-6">
            <!-- Change Password Section -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Change Password</h2>
                    <p class="settings-card-desc">Update your admin account password</p>
                </div>
                <div class="settings-card-body">
                    <div class="form-group">
                        <label class="form-label" for="currentPassword">Current Password</label>
                        <input type="password" class="form-input" id="currentPassword" autocomplete="current-password" placeholder="Enter current password">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="newPassword">New Password</label>
                        <input type="password" class="form-input" id="newPassword" autocomplete="new-password" placeholder="Enter new password">
                    </div>
                    <div class="form-group mb-0">
                        <label class="form-label" for="confirmPassword">Confirm New Password</label>
                        <input type="password" class="form-input" id="confirmPassword" autocomplete="new-password" placeholder="Confirm new password">
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="changePasswordBtn">Update Password</button>
                </div>
            </div>

            <!-- Discord Notifications -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Discord Notifications</h2>
                    <p class="settings-card-desc">Send event notifications to a Discord channel</p>
                </div>
                <div class="settings-card-body">
                    <div class="form-group">
                        <label class="form-label flex cursor-pointer items-center gap-2 text-foreground">
                            <input type="checkbox" id="discordEnabled" ${notifSettings?.discord?.enabled ? 'checked' : ''} class="accent-white">
                            Enable Discord notifications
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Webhook URL</label>
                        <input type="text" class="form-input" id="webhookUrl" value="${escapeHtml(notifSettings?.discord?.webhookUrl || '')}" placeholder="https://discord.com/api/webhooks/...">
                    </div>
                    <div class="section-title mb-3">Events</div>
                    <div class="flex flex-col gap-2">
                        ${renderEventToggle('serverStart', 'Server Start', notifSettings?.discord?.events?.serverStart)}
                        ${renderEventToggle('serverStop', 'Server Stop', notifSettings?.discord?.events?.serverStop)}
                        ${renderEventToggle('serverCrash', 'Server Crash', notifSettings?.discord?.events?.serverCrash)}
                        ${renderEventToggle('playerJoin', 'Player Join', notifSettings?.discord?.events?.playerJoin)}
                        ${renderEventToggle('playerLeave', 'Player Leave', notifSettings?.discord?.events?.playerLeave)}
                        ${renderEventToggle('backupComplete', 'Backup Complete', notifSettings?.discord?.events?.backupComplete)}
                        ${renderEventToggle('scheduledTask', 'Scheduled Task', notifSettings?.discord?.events?.scheduledTask)}
                    </div>
                </div>
                <div class="settings-card-footer settings-card-footer-split">
                    <button class="btn btn-secondary btn-sm" id="testWebhook">Test Webhook</button>
                    <button class="btn btn-primary btn-sm" id="saveNotifications">Save Notifications</button>
                </div>
            </div>

            <!-- DNS Providers -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">DNS Providers</h2>
                        <p class="settings-card-desc">Manage DNS providers for automatic record management</p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="addDnsProvider">Add Provider</button>
                </div>
                <div id="dnsProviderList">
                    <div class="page-loading p-5"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- User Management -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">User Management</h2>
                        <p class="settings-card-desc">Manage panel users and roles</p>
                    </div>
                    <div class="flex gap-2">
                        <button class="btn btn-secondary btn-sm" id="createInvite">Invite Link</button>
                        <button class="btn btn-primary btn-sm" id="addUser">Add User</button>
                    </div>
                </div>
                <div id="inviteBanner" class="hidden"></div>
                <div id="userList">
                    <div class="page-loading p-5"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- Two-Factor Authentication -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Two-Factor Authentication</h2>
                    <p class="settings-card-desc">Secure your account with TOTP-based 2FA</p>
                </div>
                <div id="twoFactorContent" class="settings-card-body">
                    <div class="page-loading p-3"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- API Keys -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">API Keys</h2>
                        <p class="settings-card-desc">Create keys for external integrations</p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="createApiKey">Create Key</button>
                </div>
                <div id="apiKeyList">
                    <div class="page-loading p-5"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- SFTP Access -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">SFTP Access</h2>
                    <p class="settings-card-desc">File transfer via SFTP protocol</p>
                </div>
                <div id="sftpStatus" class="settings-card-body">
                    <div class="page-loading p-3"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- Backup Rotation (Global) -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Backup Rotation</h2>
                    <p class="settings-card-desc">Global defaults for automatic backup cleanup. Servers can override individually.</p>
                </div>
                <div class="settings-card-body">
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label class="form-label">Max backups per server</label>
                            <input type="number" class="form-input" id="globalMaxBackups" min="0" value="0" placeholder="0 = unlimited">
                            <p class="text-[11px] text-muted-foreground mt-1">Oldest backups are deleted when exceeded</p>
                        </div>
                        <div>
                            <label class="form-label">Max backup age (days)</label>
                            <input type="number" class="form-input" id="globalMaxAge" min="0" value="0" placeholder="0 = unlimited">
                            <p class="text-[11px] text-muted-foreground mt-1">Backups older than this are auto-deleted</p>
                        </div>
                    </div>
                </div>
                <div class="settings-card-footer">
                    <button class="btn btn-primary btn-sm" id="saveGlobalRetention">Save Defaults</button>
                </div>
            </div>

            <!-- Proxy Routes -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">Proxy Routes</h2>
                        <p class="settings-card-desc">TCP reverse proxy for routing traffic to servers</p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="addProxyRoute">Add Route</button>
                </div>
                <div id="proxyRoutesList" class="settings-card-body">
                    <div class="page-loading p-3"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- SSL / TLS -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">SSL / TLS</h2>
                    <p class="settings-card-desc">Secure panel access with HTTPS</p>
                </div>
                <div id="sslStatus" class="settings-card-body">
                    <div class="page-loading p-3"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- Docker -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Docker</h2>
                    <p class="settings-card-desc">Run servers in isolated containers</p>
                </div>
                <div id="dockerStatus" class="settings-card-body">
                    <div class="page-loading p-3"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- Remote Nodes -->
            <div class="settings-card">
                <div class="settings-card-header settings-card-header-row">
                    <div>
                        <h2 class="settings-card-title">Remote Nodes</h2>
                        <p class="settings-card-desc">Manage servers across multiple machines</p>
                    </div>
                    <button class="btn btn-primary btn-sm" id="addNode">Add Node</button>
                </div>
                <div id="nodesList" class="settings-card-body">
                    <div class="page-loading p-3"><div class="spinner"></div></div>
                </div>
            </div>

            <!-- Panel Information Section -->
            <div class="settings-card">
                <div class="settings-card-header">
                    <h2 class="settings-card-title">Panel Information</h2>
                    <p class="settings-card-desc">System and runtime details</p>
                </div>
                <div>
                    <div class="list-item">
                        <span class="text-xs text-muted-foreground">Version</span>
                        <span class="font-mono text-xs" id="panelVersion">1.0.0</span>
                    </div>
                    <div class="list-item">
                        <span class="text-xs text-muted-foreground">Node.js</span>
                        <span class="font-mono text-xs" id="nodeVersion">N/A</span>
                    </div>
                    <div class="list-item">
                        <span class="text-xs text-muted-foreground">Platform</span>
                        <span class="font-mono text-xs" id="platform"></span>
                    </div>
                    <div class="list-item" id="updateRow" style="display:none">
                        <span class="text-xs text-muted-foreground">Update</span>
                        <span class="text-xs" id="updateInfo"></span>
                    </div>
                    <div class="mt-3 px-4 pb-3">
                        <button class="btn btn-secondary btn-sm" id="checkUpdateBtn">Check for Updates</button>
                    </div>
                </div>
            </div>
        </div>
        </section>
    `;

    container.querySelector('#platform').textContent = navigator.platform;

    // Load global retention settings
    api.get('/servers/backups/retention/global').then(ret => {
        const maxB = container.querySelector('#globalMaxBackups');
        const maxA = container.querySelector('#globalMaxAge');
        if (maxB) maxB.value = ret.maxBackups || 0;
        if (maxA) maxA.value = ret.maxAgeDays || 0;
    }).catch(() => {});

    // Save global retention
    container.querySelector('#saveGlobalRetention')?.addEventListener('click', async () => {
        const maxBackups = parseInt(container.querySelector('#globalMaxBackups')?.value) || 0;
        const maxAgeDays = parseInt(container.querySelector('#globalMaxAge')?.value) || 0;
        try {
            await api.put('/servers/backups/retention/global', { maxBackups, maxAgeDays });
            showToast('Global backup rotation saved', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    });

    // Load update status
    api.get('/updates').then(status => {
        if (status?.currentVersion) {
            const versionEl = container.querySelector('#panelVersion');
            if (versionEl) versionEl.textContent = status.currentVersion;
        }
        if (status?.updateAvailable) {
            const row = container.querySelector('#updateRow');
            const info = container.querySelector('#updateInfo');
            if (row && info) {
                row.style.display = '';
                info.innerHTML = `<a href="${escapeHtml(safeHref(status.releaseUrl))}" target="_blank" rel="noopener" class="text-emerald-400 hover:underline">v${escapeHtml(status.latestVersion)} available</a>`;
            }
        }
    }).catch(() => {});

    // Check for updates button
    container.querySelector('#checkUpdateBtn')?.addEventListener('click', async () => {
        const btn = container.querySelector('#checkUpdateBtn');
        btn.disabled = true;
        btn.textContent = 'Checking...';
        try {
            const status = await api.post('/updates/check');
            if (status?.updateAvailable) {
                const row = container.querySelector('#updateRow');
                const info = container.querySelector('#updateInfo');
                if (row && info) {
                    row.style.display = '';
                    info.innerHTML = `<a href="${escapeHtml(safeHref(status.releaseUrl))}" target="_blank" rel="noopener" class="text-emerald-400 hover:underline">v${escapeHtml(status.latestVersion)} available</a>`;
                }
                showToast(`Update available: v${status.latestVersion}`, 'info');
            } else {
                showToast('You\'re on the latest version', 'success');
            }
        } catch (e) {
            showToast('Failed to check for updates', 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Check for Updates';
    });

    // Change password
    container.querySelector('#changePasswordBtn')?.addEventListener('click', async () => {
        const current = container.querySelector('#currentPassword').value;
        const newPass = container.querySelector('#newPassword').value;
        const confirm = container.querySelector('#confirmPassword').value;

        if (!current || !newPass) {
            showToast('Please fill in all fields', 'error');
            return;
        }
        if (newPass !== confirm) {
            showToast('Passwords do not match', 'error');
            return;
        }
        if (newPass.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
        }

        try {
            await api.post('/auth/change-password', { currentPassword: current, newPassword: newPass });
            showToast('Password changed successfully', 'success');
            container.querySelector('#currentPassword').value = '';
            container.querySelector('#newPassword').value = '';
            container.querySelector('#confirmPassword').value = '';
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Save notification settings
    container.querySelector('#saveNotifications')?.addEventListener('click', async () => {
        const events = {};
        container.querySelectorAll('[data-event]').forEach(input => {
            events[input.dataset.event] = input.checked;
        });

        const settings = {
            discord: {
                enabled: container.querySelector('#discordEnabled').checked,
                webhookUrl: container.querySelector('#webhookUrl').value,
                events
            }
        };

        try {
            await api.put('/notifications/settings', settings);
            showToast('Notification settings saved', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Test webhook
    container.querySelector('#testWebhook')?.addEventListener('click', async () => {
        const url = container.querySelector('#webhookUrl').value;
        if (!url) {
            showToast('Enter a webhook URL first', 'error');
            return;
        }
        try {
            await api.post('/notifications/test', { webhookUrl: url });
            showToast('Test notification sent!', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    });

    // Load users
    loadUsers(container);

    // Load 2FA status
    load2FA(container);

    // Load API keys
    loadApiKeys(container);

    // Load SFTP status
    loadSFTP(container);

    // Load DNS providers
    loadDnsProviders(container);

    // Load infrastructure sections
    loadProxyRoutes(container);
    loadSSLStatus(container);
    loadDockerStatus(container);
    loadNodes(container);

    // Add DNS provider
    container.querySelector('#addDnsProvider')?.addEventListener('click', () => {
        showModal('Add DNS Provider', `
            <div class="form-group">
                <label class="form-label">Provider Name</label>
                <input type="text" class="form-input" id="dnsProviderName" placeholder="e.g., My Cloudflare">
            </div>
            <div class="form-group">
                <label class="form-label">Provider Type</label>
                <select class="form-select" id="dnsProviderType">
                    <option value="cloudflare">Cloudflare</option>
                    <option value="route53">AWS Route53</option>
                </select>
            </div>
            <div id="dnsCredFields">
                <div class="form-group">
                    <label class="form-label">API Token</label>
                    <input type="password" class="form-input" id="dnsApiToken" placeholder="Cloudflare API token">
                </div>
                <div class="form-group mb-0">
                    <label class="form-label">Zone ID</label>
                    <input type="text" class="form-input" id="dnsZoneId" placeholder="Cloudflare Zone ID">
                </div>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'add', label: 'Add Provider', class: 'btn-primary', onClick: async () => {
                const type = document.querySelector('#dnsProviderType').value;
                const name = document.querySelector('#dnsProviderName').value;
                let credentials = {};
                if (type === 'cloudflare') {
                    credentials = {
                        apiToken: document.querySelector('#dnsApiToken')?.value,
                        zoneId: document.querySelector('#dnsZoneId')?.value
                    };
                } else {
                    credentials = {
                        accessKeyId: document.querySelector('#dnsAccessKey')?.value,
                        secretAccessKey: document.querySelector('#dnsSecretKey')?.value,
                        hostedZoneId: document.querySelector('#dnsHostedZone')?.value
                    };
                }
                try {
                    await api.post('/dns/providers', { name, type, credentials });
                    showToast('DNS provider added', 'success');
                    loadDnsProviders(container);
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);

        // Switch credential fields based on type
        document.querySelector('#dnsProviderType')?.addEventListener('change', (e) => {
            const fields = document.querySelector('#dnsCredFields');
            if (!fields) return;
            if (e.target.value === 'cloudflare') {
                fields.innerHTML = `
                    <div class="form-group">
                        <label class="form-label">API Token</label>
                        <input type="password" class="form-input" id="dnsApiToken" placeholder="Cloudflare API token">
                    </div>
                    <div class="form-group mb-0">
                        <label class="form-label">Zone ID</label>
                        <input type="text" class="form-input" id="dnsZoneId" placeholder="Cloudflare Zone ID">
                    </div>
                `;
            } else {
                fields.innerHTML = `
                    <div class="form-group">
                        <label class="form-label">Access Key ID</label>
                        <input type="text" class="form-input" id="dnsAccessKey" placeholder="AWS Access Key ID">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Secret Access Key</label>
                        <input type="password" class="form-input" id="dnsSecretKey" placeholder="AWS Secret Access Key">
                    </div>
                    <div class="form-group mb-0">
                        <label class="form-label">Hosted Zone ID</label>
                        <input type="text" class="form-input" id="dnsHostedZone" placeholder="Route53 Hosted Zone ID">
                    </div>
                `;
            }
        });
    });

    // Create API key
    container.querySelector('#createApiKey')?.addEventListener('click', () => {
        showModal('Create API Key', `
            <div class="form-group">
                <label class="form-label">Description</label>
                <input type="text" class="form-input" id="apiKeyDesc" placeholder="e.g., Discord Bot Integration">
            </div>
                    <div class="form-group mb-0">
                <label class="form-label">Key Type</label>
                <select class="form-select" id="apiKeyType">
                    <option value="client">Client - Limited access</option>
                    <option value="application">Application - Full admin access</option>
                </select>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'create', label: 'Create Key', class: 'btn-primary', onClick: async () => {
                const description = document.querySelector('#apiKeyDesc')?.value;
                const type = document.querySelector('#apiKeyType')?.value;
                try {
                    const result = await api.post('/keys', { description, type });
                    showModal('API Key Created', `
                        <p class="mb-3 text-xs text-muted-foreground">Copy this key now. It will not be shown again.</p>
                        <div class="select-all break-all rounded-lg border border-border bg-muted p-3 font-mono text-[11px]">${escapeHtml(result.key)}</div>
                    `, [{ id: 'done', label: 'Done', class: 'btn-primary' }]);
                    loadApiKeys(container);
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });

    // Create invite link
    container.querySelector('#createInvite')?.addEventListener('click', () => {
        showModal('Create Invite Link', `
            <p class="text-sm text-muted-foreground mb-3">Generate a link that lets someone create their own account.</p>
            <div class="form-group">
                <label class="form-label">Role</label>
                <select class="form-select" id="inviteRole">
                    <option value="viewer">Viewer - Read-only access</option>
                    <option value="operator">Operator - Can manage servers</option>
                    <option value="admin">Admin - Full access</option>
                </select>
            </div>
            <div class="form-group mb-0">
                <label class="form-label">Expires in</label>
                <select class="form-select" id="inviteExpiry">
                    <option value="1">1 hour</option>
                    <option value="24">24 hours</option>
                    <option value="48" selected>48 hours</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                </select>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'create', label: 'Create Invite', class: 'btn-primary', onClick: async () => {
                const role = document.querySelector('#inviteRole')?.value || 'viewer';
                const expiryHours = parseInt(document.querySelector('#inviteExpiry')?.value) || 48;
                try {
                    const result = await api.post('/auth/invites', { role, expiryHours });
                    const inviteUrl = `${location.origin}/#invite=${result.code}`;
                    // Show the link in the banner area
                    const banner = container.querySelector('#inviteBanner');
                    if (banner) {
                        banner.className = 'mx-4 mb-2 rounded border border-border bg-muted px-3 py-2';
                        banner.innerHTML = `
                            <div class="flex items-center justify-between gap-2">
                                <div class="min-w-0">
                                    <p class="text-[11px] text-muted-foreground">Invite link (${escapeHtml(role)}, expires ${new Date(result.expiresAt).toLocaleString()}):</p>
                                    <p class="font-mono text-xs break-all select-all mt-0.5">${escapeHtml(inviteUrl)}</p>
                                </div>
                                <div class="flex gap-1.5 shrink-0">
                                    <button class="btn btn-sm btn-primary" id="copyInvite">Copy</button>
                                    <button class="btn btn-sm btn-secondary" id="dismissInvite">&times;</button>
                                </div>
                            </div>
                        `;
                        banner.querySelector('#copyInvite')?.addEventListener('click', () => {
                            navigator.clipboard.writeText(inviteUrl).then(() => showToast('Invite link copied', 'success'));
                        });
                        banner.querySelector('#dismissInvite')?.addEventListener('click', () => {
                            banner.className = 'hidden';
                            banner.innerHTML = '';
                        });
                    }
                    showToast('Invite link created', 'success');
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });

    // Add user
    container.querySelector('#addUser')?.addEventListener('click', () => {
        showModal('Add User', `
            <div class="form-group">
                <label class="form-label">Username</label>
                <input type="text" class="form-input" id="newUsername" placeholder="Enter username">
            </div>
            <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="form-input" id="newUserPassword" placeholder="Min 6 characters">
            </div>
            <div class="form-group mb-0">
                <label class="form-label">Role</label>
                <select class="form-select" id="newUserRole">
                    <option value="viewer">Viewer - Read-only access</option>
                    <option value="operator">Operator - Can manage servers</option>
                    <option value="admin">Admin - Full access</option>
                </select>
            </div>
        `, [
            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
            { id: 'create', label: 'Create User', class: 'btn-primary', onClick: async () => {
                const username = document.querySelector('#newUsername')?.value;
                const password = document.querySelector('#newUserPassword')?.value;
                const role = document.querySelector('#newUserRole')?.value;
                if (!username || !password) {
                    showToast('Username and password required', 'error');
                    return;
                }
                try {
                    await api.post('/auth/users', { username, password, role });
                    showToast(`User ${username} created`, 'success');
                    loadUsers(container);
                } catch (e) { showToast(e.message, 'error'); }
            }}
        ]);
    });
}

async function loadUsers(container) {
    const userList = container.querySelector('#userList');
    if (!userList) return;

    try {
        const data = await api.get('/auth/users');
        const users = data.users || [];

        userList.innerHTML = users.map((u) => {
            const roleClasses = {
                admin: 'border-border text-foreground',
                operator: 'border-border text-muted-foreground',
                viewer: 'border-border text-muted-foreground'
            };
            const isOnlyAdmin = u.role === 'admin' && users.filter(x => x.role === 'admin').length <= 1;
            return `
                <div class="list-item">
                    <div class="flex items-center gap-2.5">
                        <div class="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>
                        <div>
                            <div class="text-sm font-medium text-foreground">${escapeHtml(u.username)}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="rounded-full border px-2 py-0.5 text-[11px] capitalize ${roleClasses[u.role] || 'border-border text-muted-foreground'}">${escapeHtml(u.role)}</span>
                        <button class="btn btn-sm btn-secondary" data-reset-pw="${escapeHtml(u.username)}">Reset Password</button>
                        ${!isOnlyAdmin ? `
                            <button class="btn btn-sm btn-danger" data-delete-user="${escapeHtml(u.username)}">Remove</button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Wire reset password buttons
        userList.querySelectorAll('[data-reset-pw]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const username = btn.dataset.resetPw;
                try {
                    const result = await api.post(`/auth/users/${encodeURIComponent(username)}/reset-password`);
                    const resetUrl = `${location.origin}/#reset=${result.code}`;
                    showModal('Password Reset Link', `
                        <p class="mb-3 text-sm">Share this link with <strong>${escapeHtml(username)}</strong> to let them set a new password:</p>
                        <div class="rounded border border-border bg-muted px-3 py-2 font-mono text-xs break-all select-all">${escapeHtml(resetUrl)}</div>
                        <p class="mt-2 text-[11px] text-muted-foreground">Expires: ${new Date(result.expiresAt).toLocaleString()}</p>
                    `, [
                        { id: 'copy', label: 'Copy Link', class: 'btn-primary', onClick: () => {
                            navigator.clipboard.writeText(resetUrl).then(() => showToast('Link copied', 'success'));
                        }},
                        { id: 'close', label: 'Close', class: 'btn-secondary' }
                    ]);
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

        // Wire delete buttons
        userList.querySelectorAll('[data-delete-user]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const username = btn.dataset.deleteUser;
                showModal('Remove User', `<p>Remove user <strong>${escapeHtml(username)}</strong>? They will no longer be able to log in.</p>`, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'delete', label: 'Remove', class: 'btn-danger', onClick: async () => {
                        try {
                            await api.del(`/auth/users/${encodeURIComponent(username)}`);
                            showToast(`User ${username} removed`, 'success');
                            loadUsers(container);
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        });
    } catch (e) {
        userList.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">${escapeHtml(e.message)}</div>`;
    }
}

async function load2FA(container) {
    const content = container.querySelector('#twoFactorContent');
    if (!content) return;

    try {
        const status = await api.get('/2fa/status');
        if (status.enabled) {
            content.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                        <div class="h-2 w-2 rounded-full bg-foreground"></div>
                        <span class="text-sm font-medium text-foreground">2FA is enabled</span>
                    </div>
                    <button class="btn btn-danger btn-sm" id="disable2FA">Disable</button>
                </div>
            `;
            content.querySelector('#disable2FA')?.addEventListener('click', () => {
                showModal('Disable 2FA', `
                    <p class="mb-3 text-sm text-foreground">Enter your current 2FA code to disable.</p>
                    <div class="form-group mb-0">
                        <input type="text" class="form-input text-center text-lg tracking-[0.3em]" id="disable2FACode" placeholder="6-digit code" maxlength="8">
                    </div>
                `, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'disable', label: 'Disable 2FA', class: 'btn-danger', onClick: async () => {
                        const code = document.querySelector('#disable2FACode')?.value;
                        try {
                            await api.post('/2fa/disable', { code });
                            showToast('2FA disabled', 'success');
                            load2FA(container);
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        } else {
            content.innerHTML = `
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-sm text-foreground">2FA is not enabled</span>
                        <div class="mt-0.5 text-xs text-muted-foreground">Use an authenticator app like Google Authenticator or Authy</div>
                    </div>
                    <button class="btn btn-primary btn-sm" id="setup2FA">Enable 2FA</button>
                </div>
            `;
            content.querySelector('#setup2FA')?.addEventListener('click', async () => {
                try {
                    const result = await api.post('/2fa/setup');
                    showModal('Setup Two-Factor Authentication', `
                        <p class="mb-4 text-xs text-muted-foreground">Scan this QR code with your authenticator app, then enter the 6-digit code below.</p>
                        ${result.qrCode ? `<div class="mb-4 text-center"><img src="${escapeHtml(result.qrCode)}" class="mx-auto h-[200px] w-[200px] rounded-lg border border-border bg-white p-1"></div>` : ''}
                        <div class="mb-4 select-all rounded-lg border border-border bg-muted p-2.5 text-center font-mono text-xs tracking-[0.2em]">${escapeHtml(result.secret)}</div>
                        <div class="form-group mb-0">
                            <label class="form-label">Verification Code</label>
                            <input type="text" class="form-input text-center text-lg tracking-[0.3em]" id="verify2FACode" placeholder="Enter 6-digit code" maxlength="6">
                        </div>
                    `, [
                        { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                        { id: 'verify', label: 'Verify & Enable', class: 'btn-primary', onClick: async () => {
                            const code = document.querySelector('#verify2FACode')?.value;
                            try {
                                const verifyResult = await api.post('/2fa/verify', { code });
                                if (verifyResult.backupCodes) {
                                    showModal('Backup Codes', `
                                        <p class="mb-3 text-xs text-muted-foreground">Save these backup codes somewhere safe. Each can be used once.</p>
                                        <div class="grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-muted p-3 font-mono text-sm">
                                            ${verifyResult.backupCodes.map(c => `<div class="select-all">${escapeHtml(c)}</div>`).join('')}
                                        </div>
                                    `, [{ id: 'done', label: 'I Saved These', class: 'btn-primary' }]);
                                }
                                showToast('2FA enabled!', 'success');
                                load2FA(container);
                            } catch (e) { showToast(e.message, 'error'); }
                        }}
                    ]);
                } catch (e) { showToast(e.message, 'error'); }
            });
        }
    } catch (e) {
        content.innerHTML = `<span class="text-xs text-muted-foreground">${escapeHtml(e.message)}</span>`;
    }
}

async function loadApiKeys(container) {
    const list = container.querySelector('#apiKeyList');
    if (!list) return;

    try {
        const data = await api.get('/keys');
        const keys = data.keys || [];

        if (keys.length === 0) {
            list.innerHTML = '<div class="px-5 py-4 text-xs text-muted-foreground">No API keys created yet</div>';
            return;
        }

        list.innerHTML = keys.map((k) => `
            <div class="list-item">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-foreground">${escapeHtml(k.description)}</span>
                        <span class="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">${escapeHtml(k.type)}</span>
                        ${!k.enabled ? '<span class="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground">disabled</span>' : ''}
                    </div>
                    <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">${escapeHtml(k.keyPrefix)}</div>
                    <div class="mt-0.5 text-[10px] text-muted-foreground">${k.lastUsed ? 'Last used: ' + new Date(k.lastUsed).toLocaleDateString() : 'Never used'} &middot; ${k.usageCount} requests</div>
                </div>
                <div class="flex flex-shrink-0 gap-1.5">
                    <button class="btn btn-sm btn-secondary" data-toggle-key="${escapeHtml(k.id)}">${k.enabled ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-sm btn-danger" data-delete-key="${escapeHtml(k.id)}">Delete</button>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('[data-toggle-key]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.post(`/keys/${btn.dataset.toggleKey}/toggle`);
                    loadApiKeys(container);
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

        list.querySelectorAll('[data-delete-key]').forEach(btn => {
            btn.addEventListener('click', () => {
                const keyId = btn.dataset.deleteKey;
                showModal('Delete API Key', `
                    <p>Delete this API key?</p>
                    <p class="text-xs text-muted-foreground mt-1.5">Any service using this key will lose access immediately. This cannot be undone.</p>
                `, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                        try {
                            await api.del(`/keys/${encodeURIComponent(keyId)}`);
                            showToast('API key deleted', 'success');
                            loadApiKeys(container);
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">${escapeHtml(e.message)}</div>`;
    }
}

async function loadDnsProviders(container) {
    const list = container.querySelector('#dnsProviderList');
    if (!list) return;

    try {
        const providers = await api.get('/dns/providers');

        if (!providers || providers.length === 0) {
            list.innerHTML = '<div class="px-5 py-4 text-xs text-muted-foreground">No DNS providers configured yet</div>';
            return;
        }

        list.innerHTML = providers.map(p => {
            const typeBadge = p.type === 'cloudflare' ? 'Cloudflare' : 'Route53';
            return `
                <div class="list-item">
                    <div class="flex items-center gap-2.5">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-medium text-foreground">${escapeHtml(p.name)}</span>
                                <span class="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">${escapeHtml(typeBadge)}</span>
                            </div>
                            <div class="mt-0.5 text-[11px] text-muted-foreground">ID: ${escapeHtml(p.id)}</div>
                        </div>
                    </div>
                    <div class="flex gap-1.5">
                        <button class="btn btn-sm btn-secondary" data-test-dns="${escapeHtml(p.id)}">Test</button>
                        <button class="btn btn-sm btn-danger" data-delete-dns="${escapeHtml(p.id)}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');

        // Wire test buttons
        list.querySelectorAll('[data-test-dns]').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'Testing...';
                try {
                    const result = await api.post(`/dns/providers/${btn.dataset.testDns}/test`);
                    if (result.success) {
                        showToast('Connection successful!', 'success');
                    } else {
                        showToast(`Connection failed: ${result.error}`, 'error');
                    }
                } catch (e) { showToast(e.message, 'error'); }
                btn.disabled = false;
                btn.textContent = 'Test';
            });
        });

        // Wire delete buttons
        list.querySelectorAll('[data-delete-dns]').forEach(btn => {
            btn.addEventListener('click', async () => {
                showModal('Delete DNS Provider', `
                    <p>Delete this DNS provider? Networks using this provider will lose DNS management.</p>
                `, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                        try {
                            await api.del(`/dns/providers/${btn.dataset.deleteDns}`);
                            showToast('DNS provider deleted', 'success');
                            loadDnsProviders(container);
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">${escapeHtml(e.message)}</div>`;
    }
}

async function loadSFTP(container) {
    const content = container.querySelector('#sftpStatus');
    if (!content) return;

    try {
        const status = await api.get('/sftp/status');
        content.innerHTML = `
            <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2">
                    <div class="h-2 w-2 rounded-full ${status.running ? 'bg-foreground' : 'bg-muted-foreground'}"></div>
                    <span class="text-sm font-medium text-foreground">${status.running ? 'SFTP Server Running' : 'SFTP Server Offline'}</span>
                </div>
                ${status.running ? `
                    <div class="text-xs text-muted-foreground">
                        <div class="mb-1.5">Port: <span class="font-mono text-foreground">${status.port}</span></div>
                        <div class="mb-1.5">Active connections: <span class="text-foreground">${status.connections}</span></div>
                        <div class="mb-2">Connect with: <code class="text-[11px] text-foreground">sftp -P ${status.port} username.serverId@hostname</code></div>
                        <div class="rounded-lg border border-border bg-muted p-2.5 text-[11px] text-muted-foreground">
                            <div class="mb-1 font-medium text-foreground">Connection Format:</div>
                            <div>&bull; <code>user.serverId@host</code> - Access specific server files</div>
                            <div>&bull; <code>admin@host</code> - Admin access to all servers</div>
                        </div>
                    </div>
                ` : `
                    <div class="text-xs text-muted-foreground">SFTP server is not running. Check server logs for errors.</div>
                `}
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<span class="text-xs text-muted-foreground">${escapeHtml(e.message)}</span>`;
    }
}

function renderEventToggle(key, label, checked) {
    return `
        <label class="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input type="checkbox" data-event="${key}" ${checked ? 'checked' : ''} class="accent-white">
            ${label}
        </label>
    `;
}

// --- Proxy Routes ---

async function loadProxyRoutes(container) {
    const list = container.querySelector('#proxyRoutesList');
    if (!list) return;

    try {
        const routes = await api.get('/proxy/routes');
        if (routes.length === 0) {
            list.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">No proxy routes configured. Add a route to forward traffic to a server port.</div>`;
        } else {
            list.innerHTML = routes.map(r => `
                <div class="list-item">
                    <div class="flex flex-col gap-0.5">
                        <span class="text-sm font-medium">${escapeHtml(r.name)}</span>
                        <span class="text-xs text-muted-foreground font-mono">:${escapeHtml(String(r.listenPort))} &rarr; ${escapeHtml(r.targetHost)}:${escapeHtml(String(r.targetPort))}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs ${r.active ? 'text-emerald-400' : 'text-muted-foreground'}">${r.active ? `Active (${escapeHtml(String(r.connections))} conn)` : 'Stopped'}</span>
                        <button class="btn btn-sm btn-danger" data-delete-route="${escapeHtml(r.id)}">Delete</button>
                    </div>
                </div>
            `).join('');

            list.querySelectorAll('[data-delete-route]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const routeId = btn.dataset.deleteRoute;
                    showModal('Delete Proxy Route', `
                        <p>Delete this proxy route?</p>
                        <p class="text-xs text-muted-foreground mt-1.5">Active connections will be dropped.</p>
                    `, [
                        { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                        { id: 'delete', label: 'Delete', class: 'btn-danger', onClick: async () => {
                            try {
                                await api.del(`/proxy/routes/${encodeURIComponent(routeId)}`);
                                showToast('Route deleted', 'success');
                                loadProxyRoutes(container);
                            } catch (e) { showToast(e.message, 'error'); }
                        }}
                    ]);
                });
            });
        }
    } catch (e) {
        list.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">${escapeHtml(e.message)}</div>`;
    }

    const addBtn = container.querySelector('#addProxyRoute');
    if (addBtn && !addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', () => {
            showModal('Add Proxy Route', `
                <div class="form-group">
                    <label class="form-label">Name</label>
                    <input type="text" class="form-input" id="proxyName" placeholder="e.g., Survival Proxy">
                </div>
                <div class="form-group">
                    <label class="form-label">Listen Port</label>
                    <input type="number" class="form-input" id="proxyListenPort" placeholder="25565">
                </div>
                <div class="form-group">
                    <label class="form-label">Target Host</label>
                    <input type="text" class="form-input" id="proxyTargetHost" value="127.0.0.1" placeholder="127.0.0.1">
                </div>
                <div class="form-group">
                    <label class="form-label">Target Port</label>
                    <input type="number" class="form-input" id="proxyTargetPort" placeholder="25566">
                </div>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'add', label: 'Add Route', class: 'btn-primary', onClick: async () => {
                    const name = document.querySelector('#proxyName').value;
                    const listenPort = parseInt(document.querySelector('#proxyListenPort').value);
                    const targetHost = document.querySelector('#proxyTargetHost').value || '127.0.0.1';
                    const targetPort = parseInt(document.querySelector('#proxyTargetPort').value);
                    if (!listenPort || !targetPort) { showToast('Both ports are required', 'error'); return; }
                    try {
                        await api.post('/proxy/routes', { name, listenPort, targetHost, targetPort, enabled: true });
                        showToast('Proxy route added', 'success');
                        loadProxyRoutes(container);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        });
    }
}

// --- SSL Status ---

async function loadSSLStatus(container) {
    const content = container.querySelector('#sslStatus');
    if (!content) return;

    try {
        const status = await api.get('/proxy/ssl');
        if (!status.enabled) {
            content.innerHTML = `
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-2">
                        <div class="h-2 w-2 rounded-full bg-muted-foreground"></div>
                        <span class="text-sm font-medium">SSL Disabled</span>
                    </div>
                    <p class="text-xs text-muted-foreground">Upload a custom certificate or configure Let's Encrypt for automatic HTTPS.</p>
                    <div class="flex gap-2 mt-1">
                        <button class="btn btn-sm btn-secondary" id="sslAutoBtn">Setup Let's Encrypt</button>
                        <button class="btn btn-sm btn-secondary" id="sslCustomBtn">Upload Certificate</button>
                    </div>
                </div>
            `;
        } else {
            const cert = status.certInfo;
            content.innerHTML = `
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-2">
                        <div class="h-2 w-2 rounded-full bg-emerald-500"></div>
                        <span class="text-sm font-medium">SSL Enabled (${escapeHtml(status.mode)})</span>
                    </div>
                    ${status.domain ? `<div class="text-xs text-muted-foreground">Domain: <span class="font-mono text-foreground">${escapeHtml(status.domain)}</span></div>` : ''}
                    ${cert ? `
                        <div class="text-xs text-muted-foreground">
                            <div>Valid until: <span class="text-foreground">${new Date(cert.validTo).toLocaleDateString()}</span></div>
                            <div>Issuer: <span class="text-foreground">${escapeHtml(cert.issuer || 'Unknown')}</span></div>
                        </div>
                    ` : ''}
                    ${status.hasCertificate ? `
                        <button class="btn btn-sm btn-danger mt-1" id="sslDisableBtn">Disable SSL</button>
                    ` : ''}
                </div>
            `;
            content.querySelector('#sslDisableBtn')?.addEventListener('click', () => {
                showModal('Disable SSL', `
                    <p>Disable SSL on the panel?</p>
                    <p class="text-xs text-muted-foreground mt-1.5">The panel will revert to HTTP. Any clients connected over HTTPS will need to reconnect.</p>
                `, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'disable', label: 'Disable SSL', class: 'btn-danger', onClick: async () => {
                        try {
                            await api.post('/proxy/ssl/disable');
                            showToast('SSL disabled', 'success');
                            loadSSLStatus(container);
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        }

        content.querySelector('#sslAutoBtn')?.addEventListener('click', () => {
            showModal("Setup Let's Encrypt", `
                <div class="form-group">
                    <label class="form-label">Domain</label>
                    <input type="text" class="form-input" id="sslDomain" placeholder="panel.example.com">
                </div>
                <div class="form-group">
                    <label class="form-label">Email</label>
                    <input type="email" class="form-input" id="sslEmail" placeholder="admin@example.com">
                </div>
                <p class="text-xs text-muted-foreground">Your domain must point to this server. Port 80 must be accessible for verification.</p>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'enable', label: 'Enable', class: 'btn-primary', onClick: async () => {
                    const domain = document.querySelector('#sslDomain').value;
                    const email = document.querySelector('#sslEmail').value;
                    if (!domain || !email) { showToast('Domain and email required', 'error'); return; }
                    try {
                        await api.post('/proxy/ssl/auto', { domain, email });
                        showToast('Auto-SSL configured', 'success');
                        loadSSLStatus(container);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        });

        content.querySelector('#sslCustomBtn')?.addEventListener('click', () => {
            showModal('Upload SSL Certificate', `
                <div class="form-group">
                    <label class="form-label">Certificate (PEM)</label>
                    <textarea class="form-input" id="sslCert" rows="4" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Private Key (PEM)</label>
                    <textarea class="form-input" id="sslKey" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">CA Bundle (optional)</label>
                    <textarea class="form-input" id="sslCa" rows="3" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
                </div>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'upload', label: 'Upload', class: 'btn-primary', onClick: async () => {
                    const cert = document.querySelector('#sslCert').value;
                    const key = document.querySelector('#sslKey').value;
                    const ca = document.querySelector('#sslCa').value || undefined;
                    if (!cert || !key) { showToast('Certificate and key are required', 'error'); return; }
                    try {
                        await api.post('/proxy/ssl/custom', { cert, key, ca });
                        showToast('SSL certificate uploaded', 'success');
                        loadSSLStatus(container);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        });
    } catch (e) {
        content.innerHTML = `<span class="text-xs text-muted-foreground">${escapeHtml(e.message)}</span>`;
    }
}

// --- Docker Status ---

async function loadDockerStatus(container) {
    const content = container.querySelector('#dockerStatus');
    if (!content) return;

    try {
        const status = await api.get('/docker/status');
        if (!status.available) {
            content.innerHTML = `
                <div class="flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                        <div class="h-2 w-2 rounded-full bg-muted-foreground"></div>
                        <span class="text-sm font-medium">Docker Not Available</span>
                    </div>
                    <p class="text-xs text-muted-foreground">Docker is not installed or not running. Install Docker to enable container-based server isolation.</p>
                </div>
            `;
        } else {
            const info = status.info || {};
            content.innerHTML = `
                <div class="flex flex-col gap-3">
                    <div class="flex items-center gap-2">
                        <div class="h-2 w-2 rounded-full bg-emerald-500"></div>
                        <span class="text-sm font-medium">Docker Available</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>Containers: <span class="text-foreground">${info.containers ?? '?'} (${info.containersRunning ?? 0} running)</span></div>
                        <div>Images: <span class="text-foreground">${info.images ?? '?'}</span></div>
                        <div>CPUs: <span class="text-foreground">${info.cpus ?? '?'}</span></div>
                        <div>OS: <span class="text-foreground">${escapeHtml(info.os || '?')}</span></div>
                    </div>
                    <p class="text-xs text-muted-foreground">Enable Docker mode per-server in the server's Settings tab.</p>
                </div>
            `;
        }
    } catch (e) {
        content.innerHTML = `<span class="text-xs text-muted-foreground">${escapeHtml(e.message)}</span>`;
    }
}

// --- Remote Nodes ---

async function loadNodes(container) {
    const list = container.querySelector('#nodesList');
    if (!list) return;

    try {
        const nodes = await api.get('/nodes');
        const local = nodes.find(n => n.id === 'local');
        const remote = nodes.filter(n => n.id !== 'local');

        let html = '';

        // Local node always shows
        if (local) {
            const mem = local.systemInfo;
            const memGB = mem ? (mem.totalMemory / 1024 / 1024 / 1024).toFixed(1) : '?';
            html += `
                <div class="list-item">
                    <div class="flex flex-col gap-0.5">
                        <div class="flex items-center gap-2">
                            <div class="h-2 w-2 rounded-full bg-emerald-500"></div>
                            <span class="text-sm font-medium">${escapeHtml(local.name)}</span>
                            <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">local</span>
                        </div>
                        <span class="text-xs text-muted-foreground ml-4">${local.serverCount} server${local.serverCount !== 1 ? 's' : ''} &middot; ${mem?.cpus ?? '?'} CPUs &middot; ${memGB} GB RAM</span>
                    </div>
                </div>
            `;
        }

        // Remote nodes
        if (remote.length === 0) {
            html += `<div class="px-5 py-3 text-xs text-muted-foreground">No remote nodes. Add a node and install the agent on a remote machine.</div>`;
        } else {
            for (const n of remote) {
                const statusColor = n.status === 'online' ? 'bg-emerald-500' : n.status === 'error' ? 'bg-amber-500' : 'bg-muted-foreground';
                html += `
                    <div class="list-item">
                        <div class="flex flex-col gap-0.5">
                            <div class="flex items-center gap-2">
                                <div class="h-2 w-2 rounded-full ${statusColor}"></div>
                                <span class="text-sm font-medium">${escapeHtml(n.name)}</span>
                                ${n.host ? `<span class="font-mono text-[10px] text-muted-foreground">${escapeHtml(n.host)}</span>` : ''}
                            </div>
                            <span class="text-xs text-muted-foreground ml-4">${escapeHtml(n.status)} &middot; ${n.serverCount} server${n.serverCount !== 1 ? 's' : ''}${n.lastSeen ? ' &middot; last seen ' + new Date(n.lastSeen).toLocaleString() : ''}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button class="btn btn-sm btn-secondary" data-show-token="${escapeHtml(n.id)}" title="Show token">Token</button>
                            <button class="btn btn-sm btn-danger" data-delete-node="${escapeHtml(n.id)}">Delete</button>
                        </div>
                    </div>
                `;
            }
        }

        list.innerHTML = html;

        // Show token
        list.querySelectorAll('[data-show-token]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const node = await api.get(`/nodes/${btn.dataset.showToken}`);
                    showModal('Agent Connection Token', `
                        <p class="text-xs text-muted-foreground mb-3">Use this token when starting the agent on the remote machine:</p>
                        <div class="rounded border border-border bg-muted p-3 font-mono text-xs break-all select-all">${escapeHtml(node.token)}</div>
                        <div class="mt-3 flex gap-2">
                            <button class="btn btn-sm btn-secondary" id="copyNodeToken">Copy</button>
                            <button class="btn btn-sm btn-danger" id="regenNodeToken">Regenerate</button>
                        </div>
                    `, [{ label: 'Close', class: 'btn-secondary' }]);
                    document.querySelector('#copyNodeToken')?.addEventListener('click', () => {
                        navigator.clipboard.writeText(node.token);
                        showToast('Token copied', 'success');
                    });
                    document.querySelector('#regenNodeToken')?.addEventListener('click', () => {
                        showModal('Regenerate Token', `
                            <p>Regenerate this node's connection token?</p>
                            <p class="text-xs text-muted-foreground mt-1.5">The current agent will be disconnected and will need to be reconfigured with the new token.</p>
                        `, [
                            { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                            { id: 'regen', label: 'Regenerate', class: 'btn-danger', onClick: async () => {
                                try {
                                    await api.post(`/nodes/${encodeURIComponent(node.id)}/regenerate-token`);
                                    showToast('Token regenerated', 'success');
                                    loadNodes(container);
                                } catch (e) { showToast(e.message, 'error'); }
                            }}
                        ]);
                    });
                } catch (e) { showToast(e.message, 'error'); }
            });
        });

        // Delete node
        list.querySelectorAll('[data-delete-node]').forEach(btn => {
            btn.addEventListener('click', () => {
                const nodeId = btn.dataset.deleteNode;
                showModal('Remove Node', `
                    <p>Remove this node from the panel?</p>
                    <p class="text-xs text-muted-foreground mt-1.5">The agent on the remote machine will be disconnected. Servers running on the node will need to be migrated separately.</p>
                `, [
                    { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                    { id: 'remove', label: 'Remove Node', class: 'btn-danger', onClick: async () => {
                        try {
                            await api.del(`/nodes/${encodeURIComponent(nodeId)}`);
                            showToast('Node removed', 'success');
                            loadNodes(container);
                        } catch (e) { showToast(e.message, 'error'); }
                    }}
                ]);
            });
        });
    } catch (e) {
        list.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">${escapeHtml(e.message)}</div>`;
    }

    const addNodeBtn = container.querySelector('#addNode');
    if (addNodeBtn && !addNodeBtn.dataset.bound) {
        addNodeBtn.dataset.bound = '1';
        addNodeBtn.addEventListener('click', () => {
            showModal('Register Remote Node', `
                <div class="form-group">
                    <label class="form-label">Node Name</label>
                    <input type="text" class="form-input" id="nodeName" placeholder="e.g., EU VPS">
                </div>
                <div class="form-group">
                    <label class="form-label">Host / IP</label>
                    <input type="text" class="form-input" id="nodeHost" placeholder="e.g., 192.168.1.50">
                </div>
                <div class="form-group">
                    <label class="form-label">Description (optional)</label>
                    <input type="text" class="form-input" id="nodeDesc" placeholder="e.g., 8-core dedicated server in Frankfurt">
                </div>
                <p class="text-xs text-muted-foreground">After registering, you'll receive a connection token to install on the remote machine.</p>
            `, [
                { id: 'cancel', label: 'Cancel', class: 'btn-secondary' },
                { id: 'register', label: 'Register', class: 'btn-primary', onClick: async () => {
                    const name = document.querySelector('#nodeName').value;
                    const host = document.querySelector('#nodeHost').value;
                    const description = document.querySelector('#nodeDesc').value;
                    if (!name) { showToast('Node name required', 'error'); return; }
                    try {
                        const node = await api.post('/nodes', { name, host, description });
                        showToast('Node registered! Copy the token from the Nodes list.', 'success');
                        loadNodes(container);
                    } catch (e) { showToast(e.message, 'error'); }
                }}
            ]);
        });
    }
}

export function destroy() {
    if (openDialogCleanup) {
        openDialogCleanup();
        openDialogCleanup = null;
    }
}

let openDialogCleanup = null;

export function openSettingsDialog() {
    if (openDialogCleanup) return;

    const overlay = document.createElement('div');
    overlay.className = 'settings-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'settingsDialogTitle');
    overlay.innerHTML = `
        <div class="settings-dialog" role="document">
            <div class="settings-dialog-header">
                <div>
                    <h2 id="settingsDialogTitle" class="settings-dialog-title">Settings</h2>
                    <p class="settings-dialog-subtitle">Manage your panel configuration</p>
                </div>
                <button class="settings-dialog-close" aria-label="Close" type="button">&times;</button>
            </div>
            <div class="settings-dialog-body">
                <div class="page-loading p-5"><div class="spinner"></div></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const body = overlay.querySelector('.settings-dialog-body');
    const closeBtn = overlay.querySelector('.settings-dialog-close');

    const close = () => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        openDialogCleanup = null;
    };
    const onKey = (e) => {
        if (e.key === 'Escape' && !document.querySelector('.modal-overlay.active')) {
            close();
        }
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    openDialogCleanup = close;

    // Defer render so the overlay is mounted before any nested work runs
    requestAnimationFrame(() => {
        render(body).catch((e) => {
            body.innerHTML = `<div class="px-5 py-4 text-xs text-muted-foreground">${escapeHtml(e?.message || 'Failed to load settings')}</div>`;
        });
    });

    return close;
}
