import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createHandler } from './contact-server.mjs';

const valid = { name: 'Test Visitor', email: 'visitor@example.com', message: 'A test contact message.' };
async function fixture(t, options = {}) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    post: (body = valid, headers = {}) => fetch(`${base}/api/contact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
  };
}
const env = { RESEND_API_KEY: 'test-key', CONTACT_FROM: 'Site <site@example.com>', CONTACT_TO: 'owner@example.com' };
test('sends only to configured recipient and sets visitor reply-to', async t => {
  let request;
  const { post } = await fixture(t, { env, send: async (url, options) => {
    request = { url, ...options };
    return Response.json({ id: 'test-id' });
  } });
  const response = await post({ ...valid, to: 'attacker@example.com' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  const payload = JSON.parse(request.body);
  assert.deepEqual(payload.to, ['owner@example.com']);
  assert.equal(payload.reply_to, valid.email);
  assert.equal(payload.from, env.CONTACT_FROM);
  assert.ok(payload.text.includes(valid.message));
});
test('rejects bad input, honeypot and cross-origin requests without sending', async t => {
  const { post } = await fixture(t, { env, send: () => assert.fail('Must not send') });
  for (const body of [null, { ...valid, email: 'bad' }, { ...valid, name: 'injected\r\nheader' }, { ...valid, website: 'spam' }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post(valid, { Origin: 'https://evil.example' })).status, 403);
});
test('missing configuration and provider failures never report success', async t => {
  const unconfigured = await fixture(t, { env: {} });
  assert.equal((await unconfigured.post()).status, 503);
  const failed = await fixture(t, { env, send: async () => Response.json({ error: 'private detail' }, { status: 403 }) });
  const response = await failed.post();
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private detail'));
  const timeout = await fixture(t, { env, send: async () => { throw new Error('secret'); } });
  assert.equal((await timeout.post()).status, 502);
});
test('limits attempts and blocks oversized bodies and private files', async t => {
  const { post, base } = await fixture(t, { env: {} });
  assert.equal((await post({ ...valid, message: 'x'.repeat(25000) })).status, 413);
  for (let i = 0; i < 4; i++) await post({});
  assert.equal((await post()).status, 429);
  for (const path of ['/.env', '/server.mjs', '/package.json']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base)).status, 200);
});

test('local development server serves all page assets', async t => {
  // Vercel checks app/index before server. Shared modules must not shadow it.
  const { existsSync } = await import('node:fs');
  for (const stem of ['app', 'index', 'server', 'main']) {
    for (const extension of ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts']) {
      assert.equal(existsSync(new URL(`./${stem}.${extension}`, import.meta.url)), false);
    }
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--input-type=module', '-e', "await import('./dev-server.mjs')"], {
    cwd: new URL('./', import.meta.url),
    env: { ...process.env, VERCEL: '1', PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Entrypoint did not start')), 5000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  for (const path of ['/', '/styles.css', '/script.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0);
  }
});

test('Vercel API exports a handler without starting a listener', async () => {
  const { default: handler } = await import('./api/contact.mjs');
  assert.equal(typeof handler, 'function');
});

test('accepts Vercel pre-parsed bodies and enforces their size limit', async () => {
  let sent = false;
  const handler = createHandler({ env, send: async () => {
    sent = true;
    return Response.json({ id: 'test-id' });
  } });
  const req = { url: '/api/contact', method: 'POST', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: 'test' }, body: valid };
  const res = { writeHead(code) { this.code = code; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res);
  assert.equal(res.code, 200);
  assert.equal(sent, true);
  sent = false;
  req.body = { ...valid, message: 'x'.repeat(25000) };
  await handler(req, res);
  assert.equal(res.code, 413);
  assert.equal(sent, false);
});

test('static build contains exactly the three public files', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  await import('./build.mjs');
  assert.deepEqual((await readdir(new URL('./public/', import.meta.url))).sort(), ['index.html', 'script.js', 'styles.css']);
  for (const file of ['index.html', 'script.js', 'styles.css']) {
    assert.equal(await readFile(new URL(`./public/${file}`, import.meta.url), 'utf8'), await readFile(new URL(file, import.meta.url), 'utf8'));
  }
});
