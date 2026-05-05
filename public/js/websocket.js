// FortunaPanel WebSocket Client

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.listeners = new Map();
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.connected = false;
        this._subscriptions = new Set();
        this._wantsStats = false;
        this._reconnectTimer = null;
        this._wasConnected = false;
    }

    connect() {
        const token = localStorage.getItem('token');
        if (!token) return;

        // Clear any pending reconnect
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${location.host}/ws?token=${token}`);

        this.ws.onopen = () => {
            const wasReconnect = this._wasConnected;
            this.connected = true;
            this._wasConnected = true;
            this.reconnectDelay = 1000;
            this._emit('connected');

            // Re-subscribe to previously tracked servers and stats
            for (const serverId of this._subscriptions) {
                this.send({ type: 'subscribe', serverId });
            }
            if (this._wantsStats) {
                this.send({ type: 'subscribe-stats' });
            }

            // Show toast on reconnect (not on initial connect)
            if (wasReconnect) {
                this._emit('reconnected');
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._emit(msg.type, msg);
            } catch (e) {
                console.error('WS parse error:', e);
            }
        };

        this.ws.onclose = () => {
            this.connected = false;
            this._emit('disconnected');
            this._scheduleReconnect();
        };

        this.ws.onerror = () => {
            // onclose will fire after this
        };
    }

    _scheduleReconnect() {
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this.connected) {
                this.connect();
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
            }
        }, this.reconnectDelay);
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    subscribe(serverId) {
        this._subscriptions.add(serverId);
        this.send({ type: 'subscribe', serverId });
    }

    unsubscribe(serverId) {
        this._subscriptions.delete(serverId);
        this.send({ type: 'unsubscribe', serverId });
    }

    sendCommand(serverId, command) {
        this.send({ type: 'command', serverId, command });
    }

    subscribeStats() {
        this._wantsStats = true;
        this.send({ type: 'subscribe-stats' });
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
    }

    off(event, callback) {
        const set = this.listeners.get(event);
        if (set) set.delete(callback);
    }

    _emit(event, data) {
        const set = this.listeners.get(event);
        if (set) {
            for (const cb of set) {
                cb(data);
            }
        }
    }

    disconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._subscriptions.clear();
        this._wantsStats = false;
    }
}

export const ws = new WebSocketClient();
