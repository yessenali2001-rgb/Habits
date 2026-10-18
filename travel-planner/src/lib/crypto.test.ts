import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signFeedToken, signState, verifyFeedToken, verifyState } from './crypto';

const KEY = randomBytes(32).toString('base64');
const OTHER = randomBytes(32).toString('base64');
const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

describe('token encryption (AES-256-GCM)', () => {
  it('round-trips and never reuses an IV', () => {
    const a = encryptSecret('1//refresh-token', KEY);
    const b = encryptSecret('1//refresh-token', KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token');
    expect(decryptSecret(a, KEY)).toBe('1//refresh-token');
  });

  it('rejects tampering and the wrong key', () => {
    const enc = encryptSecret('secret', KEY);
    const parts = enc.split('.');
    const flipped = [...parts.slice(0, 3), Buffer.from('x' + Buffer.from(parts[3], 'base64url').toString('latin1')).toString('base64url')].join('.');
    expect(() => decryptSecret(flipped, KEY)).toThrow();
    expect(() => decryptSecret(enc, OTHER)).toThrow();
    expect(() => decryptSecret('v2.a.b.c', KEY)).toThrow(/format/);
  });

  it('refuses to run without a proper 32-byte key', () => {
    expect(() => encryptSecret('x', undefined)).toThrow(/not configured/);
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(/32 random bytes/);
  });
});

describe('calendar feed tokens', () => {
  it('verifies what it signed', () => {
    const tok = signFeedToken({ userId: U, tripId: T, version: 3 }, KEY);
    expect(verifyFeedToken(tok, KEY)).toEqual({ userId: U, tripId: T, version: 3 });
    expect(verifyFeedToken(signFeedToken({ userId: U, tripId: null, version: 1 }, KEY), KEY)).toEqual({ userId: U, tripId: null, version: 1 });
  });

  it('rejects forged, edited and malformed tokens', () => {
    const tok = signFeedToken({ userId: U, tripId: T, version: 1 }, KEY);
    expect(verifyFeedToken(tok, OTHER)).toBeNull();                          // signed with another secret
    expect(verifyFeedToken(tok.replace('.1.', '.2.'), KEY)).toBeNull();      // bumped version
    expect(verifyFeedToken(tok.replace(T, 'all'), KEY)).toBeNull();          // widened scope
    expect(verifyFeedToken(tok.slice(0, -2), KEY)).toBeNull();               // truncated signature
    for (const junk of ['', 'a.b.c', 'x'.repeat(200), `${U}.${T}.1`, `${U}.${T}.-1.sig`, '../../etc/passwd']) {
      expect(verifyFeedToken(junk, KEY), junk).toBeNull();
    }
  });
});

describe('OAuth state', () => {
  it('accepts a fresh signed state and rejects expired or altered ones', () => {
    const good = signState({ u: U, n: 'nonce', exp: Date.now() + 60_000 }, KEY);
    expect(verifyState(good, KEY)?.u).toBe(U);
    expect(verifyState(signState({ u: U, n: 'nonce', exp: Date.now() - 1 }, KEY), KEY)).toBeNull();
    expect(verifyState(good, OTHER)).toBeNull();
    const [body, sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ u: T, n: 'nonce', exp: Date.now() + 60_000 })).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, KEY)).toBeNull();
    expect(verifyState(`${body}.`, KEY)).toBeNull();
  });
});
