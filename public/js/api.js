// FortunaPanel API Client

class Api {
    constructor() {
        this.baseUrl = '/api';
    }

    getToken() {
        return localStorage.getItem('token');
    }

    async request(method, path, body = null) {
        const headers = { 'Content-Type': 'application/json' };
        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const options = { method, headers };
        if (body && method !== 'GET') {
            options.body = JSON.stringify(body);
        }

        const res = await fetch(`${this.baseUrl}${path}`, options);

        if (res.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login.html';
            throw new Error('Unauthorized');
        }

        if (res.status === 503) {
            // Setup mode
            return { setup: true };
        }

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || `Request failed (${res.status})`);
        }

        return data;
    }

    get(path) { return this.request('GET', path); }
    post(path, body) { return this.request('POST', path, body); }
    put(path, body) { return this.request('PUT', path, body); }
    patch(path, body) { return this.request('PATCH', path, body); }
    del(path) { return this.request('DELETE', path); }

    async upload(path, file) {
        const formData = new FormData();
        formData.append('file', file);

        const headers = {};
        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers,
            body: formData
        });

        if (res.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login.html';
            throw new Error('Unauthorized');
        }

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Upload failed');
        }

        return data;
    }
}

export const api = new Api();
