const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class JobManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxConcurrency = options.maxConcurrency || 2;
        this.maxHistory = options.maxHistory || 200;
        this.jobs = new Map();
        this.queue = [];
        this.running = 0;
    }

    createJob({ type, name, meta = {}, maxRetries = 0, run }) {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const job = {
            id,
            type,
            name: name || type,
            meta,
            status: 'queued',
            progress: 0,
            retries: 0,
            maxRetries,
            createdAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            error: null,
            result: null
        };

        this.jobs.set(id, job);
        this.queue.push({ job, run });
        this._emitUpdate(job);
        this._drain();
        return job;
    }

    getJob(id) {
        return this.jobs.get(id) || null;
    }

    listJobs({ limit = 50, status = null } = {}) {
        let list = Array.from(this.jobs.values())
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (status) list = list.filter(j => j.status === status);
        return list.slice(0, Math.max(1, Math.min(500, limit)));
    }

    cancelJob(id) {
        const idx = this.queue.findIndex(q => q.job.id === id);
        if (idx === -1) return false;
        const [{ job }] = this.queue.splice(idx, 1);
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
        this._emitUpdate(job);
        return true;
    }

    _emitUpdate(job) {
        this.emit('job-update', { ...job });
    }

    _pruneHistory() {
        const jobs = Array.from(this.jobs.values())
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const excess = jobs.slice(this.maxHistory);
        for (const j of excess) {
            if (j.status === 'running' || j.status === 'queued') continue;
            this.jobs.delete(j.id);
        }
    }

    _drain() {
        while (this.running < this.maxConcurrency && this.queue.length > 0) {
            const next = this.queue.shift();
            this._runJob(next.job, next.run);
        }
    }

    async _runJob(job, run) {
        this.running += 1;
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        job.progress = 1;
        this._emitUpdate(job);

        const context = {
            update: (progress, message = null, extra = null) => {
                if (typeof progress === 'number') {
                    job.progress = Math.max(0, Math.min(100, progress));
                }
                if (message) {
                    job.message = message;
                }
                if (extra && typeof extra === 'object') {
                    job.meta = { ...job.meta, ...extra };
                }
                this._emitUpdate(job);
            }
        };

        try {
            const result = await run(context);
            job.status = 'completed';
            job.progress = 100;
            job.result = result;
            job.finishedAt = new Date().toISOString();
            this._emitUpdate(job);
        } catch (e) {
            job.error = e.message;
            if (job.retries < job.maxRetries) {
                job.retries += 1;
                job.status = 'queued';
                job.progress = 0;
                this.queue.push({ job, run });
                this._emitUpdate(job);
            } else {
                job.status = 'failed';
                job.finishedAt = new Date().toISOString();
                this._emitUpdate(job);
                logger.error(`Job ${job.id} (${job.type}) failed: ${e.message}`);
            }
        } finally {
            this.running -= 1;
            this._pruneHistory();
            this._drain();
        }
    }
}

module.exports = JobManager;
