// FortunaPanel - DNS Provider API Clients
// Supports Cloudflare and AWS Route53

const crypto = require('crypto');
const logger = require('../utils/logger');

// ==================== Cloudflare ====================

const CF_BASE = 'https://api.cloudflare.com/client/v4';

const cloudflare = {
    async testConnection(apiToken, zoneId) {
        const res = await fetch(`${CF_BASE}/zones/${zoneId}`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.errors?.[0]?.message || 'Cloudflare API error');
        return { zoneName: data.result.name, status: data.result.status };
    },

    async listRecords(apiToken, zoneId, opts = {}) {
        const params = new URLSearchParams();
        if (opts.name) params.set('name', opts.name);
        if (opts.type) params.set('type', opts.type);
        params.set('per_page', '100');

        const res = await fetch(`${CF_BASE}/zones/${zoneId}/dns_records?${params}`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.errors?.[0]?.message || 'Failed to list records');
        return data.result;
    },

    async createRecord(apiToken, zoneId, record) {
        const body = { type: record.type, name: record.name, ttl: record.ttl || 1 };

        if (record.type === 'SRV') {
            body.data = {
                service: record.data.service,
                proto: record.data.proto,
                name: record.data.name,
                priority: record.data.priority || 0,
                weight: record.data.weight || 5,
                port: record.data.port,
                target: record.data.target
            };
        } else {
            body.content = record.content;
            if (record.proxied !== undefined) body.proxied = record.proxied;
        }

        const res = await fetch(`${CF_BASE}/zones/${zoneId}/dns_records`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.errors?.[0]?.message || 'Failed to create record');
        return data.result;
    },

    async updateRecord(apiToken, zoneId, recordId, updates) {
        const res = await fetch(`${CF_BASE}/zones/${zoneId}/dns_records/${recordId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.errors?.[0]?.message || 'Failed to update record');
        return data.result;
    },

    async deleteRecord(apiToken, zoneId, recordId) {
        const res = await fetch(`${CF_BASE}/zones/${zoneId}/dns_records/${recordId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.errors?.[0]?.message || 'Failed to delete record');
        return true;
    }
};

// ==================== AWS Route53 ====================

const R53_BASE = 'https://route53.amazonaws.com';
const R53_API_VERSION = '2013-04-01';

function _hmacSha256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

function _sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function _signV4(accessKeyId, secretAccessKey, region, service, method, path, body, headers) {
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    headers['x-amz-date'] = amzDate;
    headers['host'] = 'route53.amazonaws.com';

    const signedHeaderKeys = Object.keys(headers).sort().map(k => k.toLowerCase());
    const signedHeaders = signedHeaderKeys.join(';');
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join('');
    const payloadHash = _sha256(body || '');

    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, _sha256(canonicalRequest)].join('\n');

    let signingKey = Buffer.from(`AWS4${secretAccessKey}`, 'utf-8');
    for (const part of [dateStamp, region, service, 'aws4_request']) {
        signingKey = _hmacSha256(signingKey, part);
    }
    const signature = _hmacSha256(signingKey, stringToSign).toString('hex');

    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
}

async function _r53Request(accessKeyId, secretAccessKey, method, path, body) {
    const headers = { 'Content-Type': 'application/xml' };
    _signV4(accessKeyId, secretAccessKey, 'us-east-1', 'route53', method, path, body || '', headers);

    const res = await fetch(`${R53_BASE}${path}`, {
        method,
        headers,
        body: body || undefined
    });

    const text = await res.text();
    if (!res.ok) {
        const msgMatch = text.match(/<Message>(.*?)<\/Message>/);
        throw new Error(msgMatch ? msgMatch[1] : `Route53 API error: ${res.status}`);
    }
    return text;
}

const route53 = {
    async testConnection(accessKeyId, secretAccessKey, hostedZoneId) {
        const cleanId = hostedZoneId.replace(/^\/hostedzone\//, '');
        const xml = await _r53Request(accessKeyId, secretAccessKey, 'GET',
            `/${R53_API_VERSION}/hostedzone/${cleanId}`);
        const nameMatch = xml.match(/<Name>(.*?)<\/Name>/);
        return { zoneName: nameMatch ? nameMatch[1] : 'Unknown' };
    },

    async listRecordSets(accessKeyId, secretAccessKey, hostedZoneId) {
        const cleanId = hostedZoneId.replace(/^\/hostedzone\//, '');
        const xml = await _r53Request(accessKeyId, secretAccessKey, 'GET',
            `/${R53_API_VERSION}/hostedzone/${cleanId}/rrset`);

        // Simple XML parsing for record sets
        const records = [];
        const setMatches = xml.matchAll(/<ResourceRecordSet>([\s\S]*?)<\/ResourceRecordSet>/g);
        for (const match of setMatches) {
            const block = match[1];
            const name = block.match(/<Name>(.*?)<\/Name>/)?.[1] || '';
            const type = block.match(/<Type>(.*?)<\/Type>/)?.[1] || '';
            const ttl = block.match(/<TTL>(.*?)<\/TTL>/)?.[1] || '300';
            const values = [];
            const valMatches = block.matchAll(/<Value>(.*?)<\/Value>/g);
            for (const v of valMatches) values.push(v[1]);
            records.push({ name, type, ttl: parseInt(ttl), values });
        }
        return records;
    },

    async changeRecordSets(accessKeyId, secretAccessKey, hostedZoneId, changes) {
        const cleanId = hostedZoneId.replace(/^\/hostedzone\//, '');

        const changesXml = changes.map(c => {
            const values = (c.values || [c.value]).map(v =>
                `<ResourceRecord><Value>${v}</Value></ResourceRecord>`
            ).join('');

            return `<Change>
                <Action>${c.action}</Action>
                <ResourceRecordSet>
                    <Name>${c.name}</Name>
                    <Type>${c.type}</Type>
                    <TTL>${c.ttl || 300}</TTL>
                    <ResourceRecords>${values}</ResourceRecords>
                </ResourceRecordSet>
            </Change>`;
        }).join('');

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/${R53_API_VERSION}/">
    <ChangeBatch>
        <Changes>${changesXml}</Changes>
    </ChangeBatch>
</ChangeResourceRecordSetsRequest>`;

        await _r53Request(accessKeyId, secretAccessKey, 'POST',
            `/${R53_API_VERSION}/hostedzone/${cleanId}/rrset`, body);
        return true;
    }
};

module.exports = { cloudflare, route53 };
