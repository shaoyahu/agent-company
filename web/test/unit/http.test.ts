// http() helper 单测 — 球球 review 2026-08-15:
// 1. 4xx/5xx 抛错,err.message 透出后端 error
// 2. DELETE 没 body 不设 Content-Type(Fastify strict)
// 3. 成功 200 返 json
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { http } from '../../src/api/client.js';

let origFetch: typeof globalThis.fetch;

beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function mockFetch(responder: (url: string, init: RequestInit | undefined) => Response) {
  globalThis.fetch = (async (url: any, init?: any) =>
    responder(url, init)) as typeof globalThis.fetch;
}

test('http 200 正常返 json', async () => {
  mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const data = await http('GET', '/test');
  assert.deepEqual(data, { ok: true });
});

test('http 4xx 抛错,err.message 透出后端 { error: "..." }', async () => {
  mockFetch(() => new Response(JSON.stringify({ error: 'id must be alphanumeric/dash/underscore' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(
    http('POST', '/providers', { id: 'has space' }),
    (err: any) => err.message === 'id must be alphanumeric/dash/underscore' && err.status === 400,
  );
});

test('http 5xx 抛错,透出后端 { message: "..." }', async () => {
  mockFetch(() => new Response(JSON.stringify({ message: 'internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(
    http('GET', '/x'),
    (err: any) => err.message === 'internal error' && err.status === 500,
  );
});

test('http 4xx body 不是 JSON,fallback "HTTP <status>"', async () => {
  mockFetch(() => new Response('not json body', { status: 502 }));
  await assert.rejects(
    http('GET', '/x'),
    (err: any) => err.message === 'HTTP 502' && err.status === 502,
  );
});

test('http DELETE 没 body 不设 Content-Type(球球 review:Fastify strict)', async () => {
  let captured: RequestInit | undefined;
  mockFetch((_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  await http('DELETE', '/providers/some-id');
  // DELETE 应当 body=undefined + headers={}(不设 Content-Type)
  assert.equal(captured?.body, undefined, 'DELETE 不应有 body');
  assert.deepEqual(captured?.headers, {}, 'DELETE 不应设 Content-Type');
});

test('http POST 有 body 设 Content-Type: application/json + JSON 序列化', async () => {
  let captured: RequestInit | undefined;
  mockFetch((_url, init) => {
    captured = init;
    return new Response('{}', { status: 200 });
  });
  await http('POST', '/providers', { id: 'a', model: 'x' });
  assert.equal(captured?.headers && (captured.headers as any)['Content-Type'], 'application/json');
  assert.equal(captured?.body, JSON.stringify({ id: 'a', model: 'x' }));
});

test('http POST body=null 不设 Content-Type(避免 Fastify "body cannot be empty" 错)', async () => {
  let captured: RequestInit | undefined;
  mockFetch((_url, init) => {
    captured = init;
    return new Response('{}', { status: 200 });
  });
  await http('POST', '/x', null);
  assert.equal(captured?.body, undefined);
  assert.deepEqual(captured?.headers, {});
});

test('http err.status 始终设(不依赖 body 是否 JSON)', async () => {
  mockFetch(() => new Response('plain', { status: 503 }));
  await assert.rejects(
    http('GET', '/x'),
    (err: any) => err.status === 503,
  );
});

test('http err.body 透出 JSON body(给调试用)', async () => {
  mockFetch(() => new Response(JSON.stringify({ error: 'x', code: 'E1' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(
    http('POST', '/x', {}),
    (err: any) => err.body && err.body.error === 'x' && err.body.code === 'E1',
  );
});
