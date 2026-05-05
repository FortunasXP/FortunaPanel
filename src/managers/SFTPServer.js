// FortunaPanel - Built-in SFTP Server
// Provides SFTP access to server files using panel credentials
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const ssh2 = require('ssh2');
const config = require('../config/default');
const logger = require('../utils/logger');
const HOST_KEY_PATH = path.join(config.dataDir, 'sftp_host_key');

// Path-separator-aware containment check. Guards against the classic
// startsWith bug where rootDir="/srv/s1" permits "/srv/s1-evil".
function isInside(rootDir, candidate) {
    if (candidate === rootDir) return true;
    const sep = path.sep;
    const withSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
    return candidate.startsWith(withSep);
}

class SFTPServer {
    constructor(serverManager, permissionManager, userStore) {
        this.serverManager = serverManager;
        this.permissionManager = permissionManager;
        this.userStore = userStore;
        this.server = null;
        // Validate SFTP_PORT: must be a positive integer in the valid TCP range.
        const rawPort = parseInt(process.env.SFTP_PORT, 10);
        if (Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535) {
            this.port = rawPort;
        } else {
            if (process.env.SFTP_PORT) {
                logger.warn(`Invalid SFTP_PORT=${process.env.SFTP_PORT}, falling back to 2022`);
            }
            this.port = 2022;
        }
        this.connections = new Map();
    }

    _ensureHostKey() {
        if (!fs.existsSync(HOST_KEY_PATH)) {
            logger.info('Generating SFTP host key...');
            const keyPair = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
                publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
            });
            fs.writeFileSync(HOST_KEY_PATH, keyPair.privateKey);
            logger.info('SFTP host key generated');
        }
        return fs.readFileSync(HOST_KEY_PATH);
    }

    // Authenticate user - username format: "paneluser.serverId" or just "paneluser" for all servers
    async _authenticate(username, password) {
        const admin = this.userStore.getAdmin();
        if (!admin) return null;

        // Parse username - format: "user.serverId" or "user" (all servers)
        const parts = username.split('.');
        const panelUsername = parts[0];
        const serverId = parts.length > 1 ? parts.slice(1).join('.') : null;

        let passwordHash = null;
        let role = null;

        const user = this.userStore.getUser(panelUsername);
        if (user) {
            passwordHash = user.passwordHash;
            role = user.role;
        }

        if (!passwordHash) return null;

        const valid = await bcrypt.compare(password, passwordHash);
        if (!valid) return null;

        // Check server access
        if (serverId) {
            const server = this.serverManager.getServer(serverId);
            if (!server) return null;

            // Fail closed: if permissionManager is missing, deny. The only way
            // to reach SFTP without a permission check is the admin branch below.
            if (!this.permissionManager) {
                logger.warn(`SFTP auth denied: permissionManager unavailable for ${panelUsername}`);
                return null;
            }
            if (!this.permissionManager.hasPermission(panelUsername, serverId, 'file.sftp')) {
                return null;
            }

            return {
                username: panelUsername,
                role,
                serverId,
                rootDir: server.config.directory
            };
        }

        // Admin can access root servers directory
        if (role === 'admin') {
            return {
                username: panelUsername,
                role,
                serverId: null,
                rootDir: config.serversRoot
            };
        }

        return null;
    }

    // Resolve path safely within root directory. Returns an absolute path that
    // is provably inside rootDir, or null if the request tries to escape.
    // Callers MUST treat null as an error and refuse the operation.
    _resolvePath(rootDir, requestedPath) {
        if (typeof requestedPath !== 'string') return null;
        // Reject NUL bytes outright — fs calls may silently truncate on them.
        if (requestedPath.indexOf('\0') !== -1) return null;
        // Refuse to operate without a resolved root.
        if (typeof rootDir !== 'string' || !rootDir) return null;

        const rootResolved = path.resolve(rootDir);
        const normalized = path.normalize(requestedPath || '/').replace(/\\/g, '/');
        const resolved = path.resolve(rootResolved, normalized.startsWith('/') ? normalized.slice(1) : normalized);

        if (!isInside(rootResolved, resolved)) return null;

        // Symlink guard: resolve real path for the portion that exists and
        // verify it is still inside rootDir. For non-existent tails (CREAT,
        // MKDIR) we walk up to the nearest existing ancestor.
        try {
            const realRoot = fs.realpathSync(rootResolved);
            let probe = resolved;
            for (;;) {
                if (fs.existsSync(probe)) {
                    const real = fs.realpathSync(probe);
                    if (!isInside(realRoot, real)) return null;
                    break;
                }
                const parent = path.dirname(probe);
                if (parent === probe) break;
                probe = parent;
            }
        } catch (e) {
            return null;
        }

        return resolved;
    }

    start() {
        const hostKey = this._ensureHostKey();

        this.server = new ssh2.Server({
            hostKeys: [hostKey]
        }, (client) => {
            let authContext = null;

            client.on('authentication', async (ctx) => {
                if (ctx.method === 'password') {
                    const result = await this._authenticate(ctx.username, ctx.password);
                    if (result) {
                        authContext = result;
                        logger.info(`SFTP auth success: ${ctx.username} -> ${result.rootDir}`);
                        ctx.accept();
                    } else {
                        logger.warn(`SFTP auth failed: ${ctx.username}`);
                        ctx.reject();
                    }
                } else {
                    ctx.reject(['password']);
                }
            });

            client.on('ready', () => {
                const connId = crypto.randomUUID();
                this.connections.set(connId, { ...authContext, connectedAt: Date.now() });

                client.on('session', (accept) => {
                    const session = accept();

                    session.on('sftp', (accept) => {
                        const sftp = accept();
                        this._handleSFTP(sftp, authContext);
                    });
                });

                client.on('close', () => {
                    this.connections.delete(connId);
                });
            });

            client.on('error', (err) => {
                logger.debug(`SFTP client error: ${err.message}`);
            });
        });

        this.server.listen(this.port, '0.0.0.0', () => {
            logger.info(`SFTP server listening on port ${this.port}`);
        });
    }

    _handleSFTP(sftp, auth) {
        const rootDir = auth.rootDir;
        const openFiles = new Map();
        let handleCount = 0;

        sftp.on('OPEN', (reqid, filename, flags) => {
            const absPath = this._resolvePath(rootDir, filename);
            if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);

            let mode = 'r';
            if (flags & ssh2.SFTP_OPEN_MODE.WRITE) mode = 'w';
            if (flags & ssh2.SFTP_OPEN_MODE.APPEND) mode = 'a';
            if ((flags & ssh2.SFTP_OPEN_MODE.READ) && (flags & ssh2.SFTP_OPEN_MODE.WRITE)) mode = 'r+';
            if (flags & ssh2.SFTP_OPEN_MODE.CREAT) {
                if (flags & ssh2.SFTP_OPEN_MODE.TRUNC) mode = 'w';
                else if (flags & ssh2.SFTP_OPEN_MODE.APPEND) mode = 'a';
                else if (!fs.existsSync(absPath)) mode = 'w';
            }

            try {
                const fd = fs.openSync(absPath, mode);
                const handle = Buffer.alloc(4);
                handle.writeUInt32BE(handleCount++, 0);
                openFiles.set(handle.toString('hex'), { fd, path: absPath });
                sftp.handle(reqid, handle);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('READ', (reqid, handle, offset, length) => {
            const key = handle.toString('hex');
            const file = openFiles.get(key);
            if (!file) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);

            const buf = Buffer.alloc(length);
            try {
                const bytesRead = fs.readSync(file.fd, buf, 0, length, offset);
                if (bytesRead === 0) {
                    sftp.status(reqid, ssh2.SFTP_STATUS_CODE.EOF);
                } else {
                    sftp.data(reqid, buf.slice(0, bytesRead));
                }
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('WRITE', (reqid, handle, offset, data) => {
            const key = handle.toString('hex');
            const file = openFiles.get(key);
            if (!file) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);

            try {
                fs.writeSync(file.fd, data, 0, data.length, offset);
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.OK);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('CLOSE', (reqid, handle) => {
            const key = handle.toString('hex');
            const file = openFiles.get(key);
            if (file) {
                try { fs.closeSync(file.fd); } catch (e) {}
                openFiles.delete(key);
            }
            sftp.status(reqid, ssh2.SFTP_STATUS_CODE.OK);
        });

        sftp.on('OPENDIR', (reqid, dirPath) => {
            const absPath = this._resolvePath(rootDir, dirPath);
            if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
            try {
                if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
                    return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.NO_SUCH_FILE);
                }
                const handle = Buffer.alloc(4);
                handle.writeUInt32BE(handleCount++, 0);
                openFiles.set(handle.toString('hex'), { dir: absPath, entries: null });
                sftp.handle(reqid, handle);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('READDIR', (reqid, handle) => {
            const key = handle.toString('hex');
            const dirInfo = openFiles.get(key);
            if (!dirInfo || !dirInfo.dir) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);

            if (dirInfo.entries === null) {
                try {
                    const entries = fs.readdirSync(dirInfo.dir);
                    dirInfo.entries = entries.map(name => {
                        const fullPath = path.join(dirInfo.dir, name);
                        try {
                            const stat = fs.statSync(fullPath);
                            return {
                                filename: name,
                                longname: this._longname(name, stat),
                                attrs: this._statToAttrs(stat)
                            };
                        } catch (e) {
                            return {
                                filename: name,
                                longname: name,
                                attrs: {}
                            };
                        }
                    });
                    sftp.name(reqid, dirInfo.entries);
                } catch (e) {
                    sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
                }
            } else {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.EOF);
            }
        });

        sftp.on('STAT', (reqid, reqPath) => {
            this._sendStat(reqid, sftp, rootDir, reqPath);
        });

        sftp.on('LSTAT', (reqid, reqPath) => {
            this._sendStat(reqid, sftp, rootDir, reqPath);
        });

        sftp.on('FSTAT', (reqid, handle) => {
            const key = handle.toString('hex');
            const file = openFiles.get(key);
            if (!file) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);

            try {
                const stat = file.path ? fs.statSync(file.path) : fs.statSync(file.dir);
                sftp.attrs(reqid, this._statToAttrs(stat));
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('REMOVE', (reqid, reqPath) => {
            const absPath = this._resolvePath(rootDir, reqPath);
            if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
            try {
                fs.unlinkSync(absPath);
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.OK);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('MKDIR', (reqid, reqPath) => {
            const absPath = this._resolvePath(rootDir, reqPath);
            if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
            try {
                fs.mkdirSync(absPath, { recursive: true });
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.OK);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('RMDIR', (reqid, reqPath) => {
            const absPath = this._resolvePath(rootDir, reqPath);
            if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
            try {
                fs.rmdirSync(absPath);
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.OK);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('RENAME', (reqid, oldPath, newPath) => {
            const absOld = this._resolvePath(rootDir, oldPath);
            const absNew = this._resolvePath(rootDir, newPath);
            if (!absOld || !absNew) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
            try {
                fs.renameSync(absOld, absNew);
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.OK);
            } catch (e) {
                sftp.status(reqid, ssh2.SFTP_STATUS_CODE.FAILURE);
            }
        });

        sftp.on('REALPATH', (reqid, reqPath) => {
            const absPath = this._resolvePath(rootDir, reqPath);
            if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
            const relativePath = '/' + path.relative(rootDir, absPath).replace(/\\/g, '/');
            sftp.name(reqid, [{
                filename: relativePath || '/',
                longname: relativePath || '/',
                attrs: {}
            }]);
        });
    }

    _sendStat(reqid, sftp, rootDir, reqPath) {
        const absPath = this._resolvePath(rootDir, reqPath);
        if (!absPath) return sftp.status(reqid, ssh2.SFTP_STATUS_CODE.PERMISSION_DENIED);
        try {
            const stat = fs.statSync(absPath);
            sftp.attrs(reqid, this._statToAttrs(stat));
        } catch (e) {
            sftp.status(reqid, ssh2.SFTP_STATUS_CODE.NO_SUCH_FILE);
        }
    }

    _statToAttrs(stat) {
        return {
            mode: stat.mode,
            uid: stat.uid || 0,
            gid: stat.gid || 0,
            size: stat.size,
            atime: Math.floor(stat.atimeMs / 1000),
            mtime: Math.floor(stat.mtimeMs / 1000)
        };
    }

    _longname(name, stat) {
        const isDir = stat.isDirectory() ? 'd' : '-';
        const size = stat.size.toString().padStart(12);
        const date = new Date(stat.mtimeMs).toISOString().slice(0, 10);
        return `${isDir}rwxr-xr-x    1 owner    group    ${size} ${date} ${name}`;
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
            logger.info('SFTP server stopped');
        }
    }

    getStatus() {
        return {
            running: !!this.server,
            port: this.port,
            connections: this.connections.size,
            activeConnections: Array.from(this.connections.values()).map(c => ({
                username: c.username,
                serverId: c.serverId,
                connectedAt: c.connectedAt
            }))
        };
    }
}

module.exports = SFTPServer;
