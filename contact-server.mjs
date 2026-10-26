import http from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/script.js', ['script.js', 'text/javascript']],
]);
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;

export function createHandler({ env = process.env, send = fetch } = {}) {
  const attempts = new Map();
  let globalAttempts = [];
  const windowMs = 15 * 60 * 1000;
  return async (req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path !== '/api/contact') {
        const file = files.get(path);
        if (!file || !['GET', 'HEAD'].includes(req.method)) return json(404, { error: 'Not found.' });
        const content = await readFile(new URL(file[0], root));
        res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
      if (req.headers.origin) {
        const allowed = env.SITE_ORIGIN || `http://${req.headers.host}`;
        if (req.headers.origin !== allowed) return json(403, { error: 'Origin not allowed.' });
      }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
        return json(415, { error: 'Send JSON.' });
      }
      const now = Date.now();
      for (const [ip, times] of attempts) {
        const recent = times.filter(time => now - time < windowMs);
        if (recent.length) attempts.set(ip, recent);
        else attempts.delete(ip);
      }
      // Never trust client-supplied forwarding headers for rate limiting.
      const ip = req.socket.remoteAddress;
      const times = attempts.get(ip) || [];
      globalAttempts = globalAttempts.filter(time => now - time < windowMs);
      if (times.length >= 5 || globalAttempts.length >= 50) {
        res.setHeader('Retry-After', '900');
        return json(429, { error: 'Too many attempts. Please try again in 15 minutes.' });
      }
      attempts.set(ip, [...times, now]);
      globalAttempts.push(now);
      let data;
      // Vercel may parse JSON before invoking a Node function.
      if (req.body !== undefined) {
        const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(raw) > 24_000) return json(413, { error: 'Message is too large.' });
        try { data = JSON.parse(raw); } catch { return json(400, { error: 'Invalid JSON.' }); }
      } else {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 24_000) return json(413, { error: 'Message is too large.' });
          chunks.push(Buffer.from(chunk));
        }
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return json(400, { error: 'Invalid JSON.' }); }
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { error: 'Invalid message.' });
      if (data.website) return json(400, { error: 'Unable to submit this message.' });
      const { name, email, message } = data;
      if ([name, email, message].some(value => typeof value !== 'string') ||
          !name.trim() || name.length > 100 || /[\r\n]/.test(name) ||
          email.length > 254 || !emailPattern.test(email.trim()) ||
          message.trim().length < 10 || message.length > 5000) {
        return json(400, { error: 'Enter a name, valid email, and message of 10–5000 characters.' });
      }
      if (!env.RESEND_API_KEY || !env.CONTACT_FROM || !emailPattern.test(env.CONTACT_TO || '')) {
        return json(503, { error: 'Email delivery is not configured yet. Please use the email link.' });
      }
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.CONTACT_FROM,
          to: [env.CONTACT_TO],
          reply_to: email.trim(),
          subject: `Website message from ${name.trim()}`,
          text: `${message.trim()}\n\nFrom: ${name.trim()}\nEmail: ${email.trim()}`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (!response.ok || !result.id) return json(502, { error: 'Email could not be sent. Please try again later or use the email link.' });
      return json(200, { ok: true });
    } catch {
      if (!res.headersSent) json(502, { error: 'Unable to confirm sending. Please try later or use the email link.' });
      else res.end();
    }
  };
}

export function createServer(options) {
  return http.createServer(createHandler(options));
}

