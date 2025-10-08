import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const root = path.join(process.cwd(), 'explorer');
const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/mcps/explorer') {
        const proxy = http.request(
            {
                hostname: '127.0.0.1',
                port: 7101,
                path: '/mcp',
                method: req.method,
                headers: { ...req.headers, host: '127.0.0.1:7101' }
            },
            upstream => {
                res.writeHead(upstream.statusCode || 200, upstream.headers);
                upstream.pipe(res, { end: true });
            }
        );
        req.pipe(proxy, { end: true });
        proxy.on('error', err => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: String(err) }));
        });
        return;
    }

    const filePath = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        return fs.createReadStream(filePath).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(8080, () => {
    console.log('Local explorer available at http://127.0.0.1:8080');
});
