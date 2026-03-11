#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.resolve(__dirname, '..', '..');
const STATE_KEY = 'logoParticleEngineStateV1';

let latestState = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sanitizePath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split('?')[0]);
  const withIndex = cleaned.endsWith('/') ? `${cleaned}index.html` : cleaned;
  const filePath = path.normalize(path.join(ROOT, withIndex));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function serveFile(req, res) {
  const filePath = sanitizePath(req.url || '/');
  if (!filePath) {
    sendText(res, 400, 'Bad path');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function isStateObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const server = http.createServer((req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, 'Invalid request');
    return;
  }

  if (req.url.startsWith('/api/state')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, latestState || { key: STATE_KEY, state: null });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf-8');
        if (body.length > 10 * 1024 * 1024) {
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!isStateObject(parsed)) {
            sendJson(res, 400, { error: 'State must be an object' });
            return;
          }
          latestState = parsed;
          sendJson(res, 200, { ok: true });
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON payload' });
        }
      });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  serveFile(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Logo Particle Engine state server running on http://${HOST}:${PORT}`);
});
