#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.md': 'text/markdown; charset=utf-8',
};

async function serveStaticFile(res, filePath) {
    try {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': contentType,
            'Last-Modified': stats.mtime.toUTCString(),
        });
        res.end(content);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found.');
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = url.pathname;
    if (pathname === '/' || pathname === '') {
        pathname = 'index.html';
    } else {
        pathname = pathname.replace(/^\//, '');
    }
    const filePath = path.join(__dirname, pathname);
    await serveStaticFile(res, filePath);
});

server.listen(PORT, () => {
    console.log(`WAC Test Server running at http://localhost:${PORT}`);
    console.log(`  Demo page:     http://localhost:${PORT}/`);
    console.log(`  WAC.json:      http://localhost:${PORT}/WAC.json`);
});
