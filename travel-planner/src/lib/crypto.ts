import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Server-only helpers for secrets that must never be stored or sent in the clear:
 *   - AES-256-GCM encryption for third-party OAuth tokens kept in the database;
 *   - HMAC signing for calendar-subscription URLs and OAuth `state`.
 * Keys come from the environment (see .env.example); nothing is hard-coded.
 */

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

function key32(secret: string | undefined, name: string): Buffer {
  if (!secret) throw new Error(`${name} is not configured`);
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 random bytes, base64-encoded (openssl rand -base64 32)`);
  return key;
}

/** Output: `v1.<iv>.<auth tag>.<ciphertext>` (all base64url). A fresh random IV is used every time. */
export function encryptSecret(plain: string, secret = process.env.TOKEN_ENCRYPTION_KEY): string {
  const key = key32(secret, 'TOKEN_ENCRYPTION_KEY');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', b64u(iv), b64u(cipher.getAuthTag()), b64u(enc)].join('.');
}

export function decryptSecret(token: string, secret = process.env.TOKEN_ENCRYPTION_KEY): string {
  const key = key32(secret, 'TOKEN_ENCRYPTION_KEY');
  const [v, iv, tag, enc] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, fromB64u(iv));
  decipher.setAuthTag(fromB64u(tag));
  return Buffer.concat([decipher.update(fromB64u(enc)), decipher.final()]).toString('utf8'); // throws if tampered
}

export function hmac(data: string, secret = process.env.FEED_SIGNING_SECRET): string {
  if (!secret) throw new Error('FEED_SIGNING_SECRET is not configured');
  return createHmac('sha256', Buffer.from(secret, 'base64')).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FeedClaim { userId: string; tripId: string | null; version: number }

/**
 * Subscription URLs carry their own proof: `<user>.<trip|all>.<version>.<hmac>`.
 * Nothing secret is stored; bumping `version` in `calendar_feeds` revokes every older URL.
 */
export function signFeedToken(c: FeedClaim, secret?: string): string {
  const body = `${c.userId}.${c.tripId ?? 'all'}.${c.version}`;
  return `${body}.${hmac('feed:' + body, secret)}`;
}

export function verifyFeedToken(token: string, secret?: string): FeedClaim | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [userId, trip, ver, sig] = parts;
  if (!UUID.test(userId) || !(trip === 'all' || UUID.test(trip)) || !/^\d{1,9}$/.test(ver)) return null;
  const expected = hmac(`feed:${userId}.${trip}.${ver}`, secret);
  if (!safeEqual(sig, expected)) return null;
  return { userId, tripId: trip === 'all' ? null : trip, version: Number(ver) };
}

/** Short-lived signed OAuth state that also binds the flow to the browser that started it (nonce cookie). */
export function signState(payload: { u: string; n: string; exp: number }, secret?: string): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac('state:' + body, secret)}`;
}

export function verifyState(state: string, secret?: string): { u: string; n: string; exp: number } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig || !safeEqual(sig, hmac('state:' + body, secret))) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString('utf8'));
    if (typeof p.u !== 'string' || typeof p.n !== 'string' || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export const randomNonce = () => randomBytes(16).toString('base64url');
