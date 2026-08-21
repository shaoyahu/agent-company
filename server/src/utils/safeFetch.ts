/**
 * safeFetch — 防止 SSRF 的 fetch 包装
 *
 * 球球 review C4: 任何 user-supplied URL 调 fetch 必须走这个 helper。
 * 拒绝:
 *   - private RFC1918 / link-local / loopback / ULA / IPv6 link-local 等内网段
 *   - 非 http/https 协议
 *   - host 解析不到 IP(无法判定)
 *
 * 走公网 LLM provider endpoint 的 fetch 应该传 { trustHost: true }(由 pi-bridge
 * 内部使用,不走这个 helper)。
 *
 * Usage:
 *   await safeFetch(userUrl, init)            // 走 deny-list
 *   await safeFetch(userUrl, init, { timeoutMs: 5000 })
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SafeFetchOptions {
  /** 超时(毫秒),默认 15000 */
  timeoutMs?: number;
  /** 强制走原始 globalThis.fetch(绕过 deny-list),仅 LLM provider 端点用 */
  trustHost?: boolean;
}

const MAX_REDIRECTS = 5;

/** IPv4 private/reserved/loopback/link-local 段 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 10) return true;                                    // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true;             // 172.16/12
  if (a === 192 && b === 168) return true;                      // 192.168/16
  if (a === 127) return true;                                   // 127/8 loopback
  if (a === 169 && b === 254) return true;                      // 169.254/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true;            // 100.64/10 CGN
  if (a === 0) return true;                                     // 0/8
  if (a === 192 && b === 0) return true;                        // 192.0/24 IETF
  if (a === 192 && b === 88 && parts[2] === 99) return true;    // 6to4 anycast
  if (a === 198 && (b === 18 || b === 19)) return true;         // benchmark
  if (a >= 224) return true;                                    // 224/4 multicast + 240/4 reserved
  return false;
}

/** IPv6 private/reserved/loopback/link-local 段 */
export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]!;
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (lower.startsWith('fe80')) return true;                          // fe80::/10 link-local
  // 球球 review 2026-08-16:之前只查 fe80 前缀,漏了 fe81-febf。fe80::/10 实际是
  // 前 10 位 = 1111 1110 10,即 bytes[0..1] = fe80-febf
  if (/^fe[89ab][0-9a-f]/i.test(lower)) return true;
  if (lower.startsWith('ff')) return true;                            // ff00::/8 multicast
  if (lower.startsWith('2001:db8')) return true;                      // documentation
  // 6to4 (2002::/16) — 不算完全 private 但应挡
  if (lower.startsWith('2002:')) return true;
  return false;
}

function isPrivateIP(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true; // 未知格式默认拒绝
}

/** host 是字面 IP 还是域名?字面 IP 直接判定,域名解析后判定 */
async function hostIsPrivate(hostname: string): Promise<boolean> {
  // 去掉 IPv6 brackets
  const h = hostname.replace(/^\[|\]$/g, '');
  if (isIP(h)) return isPrivateIP(h);
  // 域名:解析所有 A/AAAA 记录,任一为 private 即拒
  try {
    const addrs = await lookup(h, { all: true });
    return addrs.some((a) => isPrivateIP(a.address));
  } catch {
    return true; // 解析失败:保守拒绝
  }
}

export class UnsafeURLError extends Error {
  constructor(url: string, reason: string) {
    super(`Refused to fetch "${url}": ${reason}`);
    this.name = 'UnsafeURLError';
  }
}

/**
 * SSRF-safe fetch 包装
 * @throws UnsafeURLError when URL points to a private/loopback/reserved range
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 15000, trustHost = false } = opts;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeURLError(url, 'not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeURLError(url, `protocol ${parsed.protocol} not allowed (only http/https)`);
  }

  if (!trustHost) {
    if (await hostIsPrivate(parsed.hostname)) {
      throw new UnsafeURLError(
        url,
        `host "${parsed.hostname}" is in a private/loopback/reserved range (SSRF guard)`,
      );
    }
  }

  // 注入 timeout signal(不破坏调用方传进来的)
  const signal = init?.signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const finalSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let currentUrl = parsed;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!trustHost && await hostIsPrivate(currentUrl.hostname)) {
      throw new UnsafeURLError(
        currentUrl.toString(),
        `host "${currentUrl.hostname}" is in a private/loopback/reserved range (SSRF guard)`,
      );
    }

    const response = await globalThis.fetch(currentUrl, {
      ...init,
      redirect: 'manual',
      signal: finalSignal,
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    try {
      currentUrl = new URL(location, currentUrl);
    } catch {
      throw new UnsafeURLError(location, 'redirect location is not a valid URL');
    }
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new UnsafeURLError(currentUrl.toString(), `protocol ${currentUrl.protocol} not allowed (only http/https)`);
    }
  }

  throw new UnsafeURLError(url, `too many redirects (max ${MAX_REDIRECTS})`);
}
