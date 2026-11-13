import https from 'node:https';
import { config } from '../config/index.js';

/** GET a JSON document from the staging API. */
export function getJson(path) {
  const url = new URL(path, config.stagingApiUrl);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { accept: 'application/json' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`staging ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export function fetchFeatureFlags() {
  return getJson('/v1/flags');
}
