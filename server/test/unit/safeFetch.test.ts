// 球球 review 2026-08-15 C4:SSRF deny-list 必须有单测,任何改动都先跑测
// 直接测纯函数 + 测 safeFetch 的几个 integration case(协议拒绝 / trustHost 跳过)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIPv4, isPrivateIPv6, safeFetch, UnsafeURLError } from '../../src/utils/safeFetch.js';

// ─── isPrivateIPv4 纯函数测试 ──────────────────────────────

test('isPrivateIPv4 — RFC1918 10/8 私有', () => {
  assert.equal(isPrivateIPv4('10.0.0.1'), true);
  assert.equal(isPrivateIPv4('10.255.255.254'), true);
});

test('isPrivateIPv4 — RFC1918 172.16/12 私有', () => {
  assert.equal(isPrivateIPv4('172.16.0.1'), true);
  assert.equal(isPrivateIPv4('172.31.255.254'), true);
  assert.equal(isPrivateIPv4('172.15.0.1'), false, '172.15 不在 172.16-31 段');
  assert.equal(isPrivateIPv4('172.32.0.1'), false);
});

test('isPrivateIPv4 — RFC1918 192.168/16 私有', () => {
  assert.equal(isPrivateIPv4('192.168.1.1'), true);
  assert.equal(isPrivateIPv4('192.168.255.255'), true);
  assert.equal(isPrivateIPv4('192.169.0.1'), false);
});

test('isPrivateIPv4 — 127/8 loopback', () => {
  assert.equal(isPrivateIPv4('127.0.0.1'), true);
  assert.equal(isPrivateIPv4('127.255.255.254'), true);
});

test('isPrivateIPv4 — 169.254/16 link-local(SSRF 高危,AWS metadata 在这)', () => {
  assert.equal(isPrivateIPv4('169.254.169.254'), true, 'AWS metadata 服务 IP,必须拒');
  assert.equal(isPrivateIPv4('169.254.0.1'), true);
});

test('isPrivateIPv4 — 100.64/10 CGN', () => {
  assert.equal(isPrivateIPv4('100.64.0.1'), true);
  assert.equal(isPrivateIPv4('100.127.255.254'), true);
  assert.equal(isPrivateIPv4('100.63.0.1'), false);
  assert.equal(isPrivateIPv4('100.128.0.1'), false);
});

test('isPrivateIPv4 — 0/8 / 192.0/24 / 6to4 / benchmark / 224+', () => {
  assert.equal(isPrivateIPv4('0.0.0.0'), true, '0/8');
  assert.equal(isPrivateIPv4('192.0.0.1'), true, '192.0/24 IETF');
  assert.equal(isPrivateIPv4('192.88.99.1'), true, '6to4 anycast');
  assert.equal(isPrivateIPv4('198.18.0.1'), true, 'benchmark');
  assert.equal(isPrivateIPv4('198.19.0.1'), true, 'benchmark');
  assert.equal(isPrivateIPv4('224.0.0.1'), true, 'multicast');
  assert.equal(isPrivateIPv4('255.255.255.255'), true, 'reserved');
});

test('isPrivateIPv4 — 公有 IP 不应被拒', () => {
  assert.equal(isPrivateIPv4('8.8.8.8'), false, 'Google DNS 公有');
  assert.equal(isPrivateIPv4('1.1.1.1'), false, 'Cloudflare DNS 公有');
  assert.equal(isPrivateIPv4('93.184.216.34'), false, 'example.com 公有');
  assert.equal(isPrivateIPv4('172.15.0.1'), false, '172.15 公有');
  assert.equal(isPrivateIPv4('11.0.0.1'), false, '11/8 公有');
});

test('isPrivateIPv4 — 格式错(不是 4 段 / 非数字)不算 private', () => {
  // isPrivateIP 形式不合法会返 false,真正调用链路里 hostIsPrivate 走 isIP 判定
  // 这里只测纯函数,格式错应该 false
  assert.equal(isPrivateIPv4('1.2.3'), false);
  assert.equal(isPrivateIPv4('1.2.3.4.5'), false);
  assert.equal(isPrivateIPv4('not.an.ip'), false);
});

// ─── isPrivateIPv6 纯函数测试 ──────────────────────────────

test('isPrivateIPv6 — ::1 loopback', () => {
  assert.equal(isPrivateIPv6('::1'), true);
});

test('isPrivateIPv6 — :: unspecified', () => {
  assert.equal(isPrivateIPv6('::'), true);
});

test('isPrivateIPv6 — fc00::/7 ULA', () => {
  assert.equal(isPrivateIPv6('fc00::1'), true);
  assert.equal(isPrivateIPv6('fd12:3456:789a::1'), true);
});

test('isPrivateIPv6 — fe80::/10 link-local', () => {
  assert.equal(isPrivateIPv6('fe80::1'), true);
  assert.equal(isPrivateIPv6('febf:ffff::1'), true);
});

test('isPrivateIPv6 — ff00::/8 multicast', () => {
  assert.equal(isPrivateIPv6('ff02::1'), true);
});

test('isPrivateIPv6 — 2001:db8::/32 文档段', () => {
  assert.equal(isPrivateIPv6('2001:db8::1'), true);
});

test('isPrivateIPv6 — 2002::/16 6to4', () => {
  assert.equal(isPrivateIPv6('2002::1'), true);
});

test('isPrivateIPv6 — 公有 IPv6 不应被拒', () => {
  assert.equal(isPrivateIPv6('2001:4860:4860::8888'), false, 'Google 公有 IPv6 DNS');
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false, 'Cloudflare 公有 IPv6 DNS');
});

test('isPrivateIPv6 — 带 zone id (fe80::1%eth0) 也应识别', () => {
  assert.equal(isPrivateIPv6('fe80::1%eth0'), true);
});

// ─── safeFetch integration 测试 ──────────────────────────────

test('safeFetch — file:// 协议拒绝', async () => {
  await assert.rejects(
    safeFetch('file:///etc/passwd'),
    (err: unknown) => err instanceof UnsafeURLError && /protocol/.test(err.message),
  );
});

test('safeFetch — ftp:// 协议拒绝', async () => {
  await assert.rejects(
    safeFetch('ftp://example.com/'),
    (err: unknown) => err instanceof UnsafeURLError && /protocol/.test(err.message),
  );
});

test('safeFetch — 非法 URL 拒绝', async () => {
  await assert.rejects(
    safeFetch('not a url'),
    (err: unknown) => err instanceof UnsafeURLError && /not a valid URL/.test(err.message),
  );
});

test('safeFetch — 私有 IPv4 字面量 拒(走 hostIsPrivate 分支)', async () => {
  await assert.rejects(
    safeFetch('http://10.0.0.1/x'),
    (err: unknown) => err instanceof UnsafeURLError && /private\/loopback\/reserved range/.test(err.message),
  );
});

test('safeFetch — link-local 169.254.169.254 拒(SSRF 高危,AWS metadata)', async () => {
  await assert.rejects(
    safeFetch('http://169.254.169.254/latest/meta-data/'),
    (err: unknown) => err instanceof UnsafeURLError,
  );
});

test('safeFetch — localhost (127.0.0.1) 拒', async () => {
  await assert.rejects(
    safeFetch('http://localhost/x'),
    (err: unknown) => err instanceof UnsafeURLError,
  );
});

test('safeFetch — IPv6 ::1 字面量 拒', async () => {
  await assert.rejects(
    safeFetch('http://[::1]/x'),
    (err: unknown) => err instanceof UnsafeURLError,
  );
});

test('safeFetch — trustHost: true 跳过 deny-list(直接 timeout,不应抛 UnsafeURLError)', async () => {
  // 10.0.0.1 私有,trustHost 跳过,真发请求(无 host)。100ms timeout 会 abort,抛 AbortError 而非 UnsafeURLError
  try {
    await safeFetch('http://10.0.0.1/x', {}, { trustHost: true, timeoutMs: 100 });
    // 如果通了(碰巧连上)也没事,关键是不应抛 UnsafeURLError
  } catch (err: any) {
    assert.ok(!(err instanceof UnsafeURLError), `trustHost=true 不应抛 UnsafeURLError,实际 ${err.name}: ${err.message}`);
  }
});

test('safeFetch — 重定向到私网地址时拒绝', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    }
    throw new Error('私网重定向不应发起请求');
  }) as typeof fetch;
  try {
    await assert.rejects(
      safeFetch('https://example.com/redirect'),
      (err: unknown) => err instanceof UnsafeURLError && /SSRF guard/.test(err.message),
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
