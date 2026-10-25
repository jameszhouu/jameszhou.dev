import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './server.mjs';

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
