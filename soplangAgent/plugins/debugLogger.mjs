/**
 * Debug logger for SOPLang Builder.
 * Logs information only when ACHILLES_DEBUG=true or ACHILLES_DEBUG=1.
 * Writes logs to achilles-debug.log in current working directory.
 * Uses a lock file to coordinate concurrent writes across processes.
 */

import fs from "node:fs";
import path from "node:path";

const LOCK_SUFFIX = ".lock";
const DEFAULT_LOCK_WAIT_MS = 2000;
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_LOCK_STALE_MS = 30000;

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const LOCK_WAIT_MS = parsePositiveInt(process.env.ACHILLES_DEBUG_LOCK_WAIT_MS, DEFAULT_LOCK_WAIT_MS);
const LOCK_RETRY_MS = parsePositiveInt(process.env.ACHILLES_DEBUG_LOCK_RETRY_MS, DEFAULT_LOCK_RETRY_MS);
const LOCK_STALE_MS = parsePositiveInt(process.env.ACHILLES_DEBUG_LOCK_STALE_MS, DEFAULT_LOCK_STALE_MS);

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

const isDebugEnabled = () => {
    const val = process.env.ACHILLES_DEBUG;
    return val === 'true' || val === '1';
};

const timestamp = () => new Date().toISOString();

const getLogFilePath = () => path.join(process.cwd(), 'achilles-debug.log');
const getLockFilePath = () => `${getLogFilePath()}${LOCK_SUFFIX}`;

const sleepSync = (ms) => {
    Atomics.wait(sleepBuffer, 0, 0, ms);
};

const acquireLock = (lockFile) => {
    const startedAt = Date.now();

    while (true) {
        try {
            const fd = fs.openSync(lockFile, "wx");
            fs.writeFileSync(fd, `${process.pid} ${startedAt}\n`, "utf8");
            return fd;
        } catch (err) {
            if (err?.code !== "EEXIST") {
                throw err;
            }

            try {
                const stat = fs.statSync(lockFile);
                const ageMs = Date.now() - stat.mtimeMs;
                if (ageMs > LOCK_STALE_MS) {
                    try {
                        fs.unlinkSync(lockFile);
                    } catch (unlinkErr) {
                        if (unlinkErr?.code !== "ENOENT") {
                            throw unlinkErr;
                        }
                    }
                    continue;
                }
            } catch (statErr) {
                if (statErr?.code === "ENOENT") {
                    continue;
                }
                throw statErr;
            }

            if (Date.now() - startedAt >= LOCK_WAIT_MS) {
                throw new Error(`Timed out acquiring lock after ${LOCK_WAIT_MS}ms`);
            }

            sleepSync(LOCK_RETRY_MS);
        }
    }
};

const releaseLock = (lockFile, fd) => {
    try {
        fs.closeSync(fd);
    } catch (_) {}

    try {
        fs.unlinkSync(lockFile);
    } catch (err) {
        if (err?.code !== "ENOENT") {
            throw err;
        }
    }
};

const formatArgs = (args) => {
    return args.map(arg => {
        if (arg === undefined) return 'undefined';
        if (arg === null) return 'null';
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
};

const writeToFile = (level, args) => {
    if (!isDebugEnabled()) return;

    const logFile = getLogFilePath();
    const lockFile = getLockFilePath();
    const message = `[${level} ${timestamp()}] ${formatArgs(args)}\n`;
    let lockFd = null;

    try {
        lockFd = acquireLock(lockFile);
        fs.appendFileSync(logFile, message, 'utf8');
    } catch (err) {
        // Fallback to console if file write fails
        console.error(`Failed to write to log file: ${err.message}`);
    } finally {
        if (lockFd !== null) {
            try {
                releaseLock(lockFile, lockFd);
            } catch (releaseErr) {
                console.error(`Failed to release log lock: ${releaseErr.message}`);
            }
        }
    }
};

export const debug = {
    log: (...args) => {
        writeToFile('DEBUG', args);
    },
    info: (...args) => {
        writeToFile('INFO', args);
    },
    warn: (...args) => {
        writeToFile('WARN', args);
    },
    error: (...args) => {
        writeToFile('ERROR', args);
    },
    group: (label) => {
        writeToFile('GROUP', [`>>> ${label}`]);
    },
    groupEnd: () => {
        writeToFile('GROUP', ['<<<']);
    },
    isEnabled: isDebugEnabled,
    getLogFilePath,
};

export default debug;
