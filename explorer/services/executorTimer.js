class ExecutorTimer {
    constructor() {
        this.jobs = new Map();
    }

    schedule(key, callback, delay = 1500) {
        if (!key) {
            throw new Error("ExecutorTimer.schedule requires a key.");
        }
        if (typeof callback !== "function") {
            throw new TypeError("ExecutorTimer.schedule requires a callback function.");
        }
        this.cancel(key);
        const handle = window.setTimeout(async () => {
            this.jobs.delete(key);
            try {
                await callback();
            } catch (error) {
                console.error(`ExecutorTimer job "${key}" failed`, error);
            }
        }, delay);
        this.jobs.set(key, { handle, callback, delay });
    }

    cancel(key) {
        const job = this.jobs.get(key);
        if (!job) {
            return;
        }
        window.clearTimeout(job.handle);
        this.jobs.delete(key);
    }

    isScheduled(key) {
        return this.jobs.has(key);
    }

    async flush(key) {
        const job = this.jobs.get(key);
        if (!job) {
            return;
        }
        this.cancel(key);
        try {
            await job.callback();
        } catch (error) {
            console.error(`ExecutorTimer flush for "${key}" failed`, error);
        }
    }

    clear() {
        for (const [key, job] of this.jobs.entries()) {
            window.clearTimeout(job.handle);
            this.jobs.delete(key);
        }
    }
}

const executorTimer = new ExecutorTimer();
export default executorTimer;
