import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RANKED_PACK } from '@/engine/packs';
import {
  TICKET_TTL_MS,
  TicketConfigError,
  issueFreeTicket,
  issueStamp,
  issueTicket,
  readTicket,
  verifyStamp,
  verifyTicket,
} from '@/server/tickets';

const SECRET_A = 'test-secret-a-test-secret-a-test-secret-a';
const SECRET_B = 'test-secret-b-test-secret-b-test-secret-b';
const NOW = 1_800_000_000_000;
const request = { language: 'en', pack: RANKED_PACK.en, mode: 'time', amount: 60 } as const;

function flipChar(token: string, at: number): string {
  const c = token.charAt(at);
  const next = c === 'A' ? 'B' : 'A';
  return token.slice(0, at) + next + token.slice(at + 1);
}

function forge(kid: string, payload: unknown, secret: string, domain = 'ticket'): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(`${domain}.${kid}.${body}`).digest('base64url');
  return `${kid}.${body}.${mac}`;
}

describe('tickets', () => {
  const saved = process.env.TICKET_SECRETS;
  beforeEach(() => {
    process.env.TICKET_SECRETS = `k2:${SECRET_B},k1:${SECRET_A}`;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TICKET_SECRETS;
    else process.env.TICKET_SECRETS = saved;
  });

  it('round-trips and carries everything a replay needs, with no user', () => {
    const { token, ticket } = issueTicket(request, NOW);
    const check = verifyTicket(token, NOW + 1000);
    expect(check).toEqual({ ok: true, ticket });
    expect(ticket).toMatchObject({ v: 1, language: 'en', pack: 'en-1k@1', mode: 'time', amount: 60, iat: NOW, exp: NOW + TICKET_TTL_MS });
    expect(ticket.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(ticket)).not.toMatch(/user/i);
  });

  it('draws a fresh nonce and seed for every ticket', () => {
    const a = issueTicket(request, NOW).ticket;
    const b = issueTicket(request, NOW).ticket;
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.seed).not.toBe(b.seed);
  });

  it('expires at 20 minutes', () => {
    const { token } = issueTicket(request, NOW);
    expect(verifyTicket(token, NOW + TICKET_TTL_MS).ok).toBe(true);
    expect(verifyTicket(token, NOW + TICKET_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(readTicket(token).ok).toBe(true);
  });

  it('signs with the first key and still verifies a rotated-out one', () => {
    const { token } = issueTicket(request, NOW);
    expect(token.startsWith('k2.')).toBe(true);
    process.env.TICKET_SECRETS = `k3:${SECRET_A},k2:${SECRET_B}`;
    expect(verifyTicket(token, NOW).ok).toBe(true);
  });

  it('rejects a key id nobody holds', () => {
    const { token } = issueTicket(request, NOW);
    process.env.TICKET_SECRETS = `k9:${SECRET_A}`;
    expect(verifyTicket(token, NOW)).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('rejects a key id swapped for another key', () => {
    const { token } = issueTicket(request, NOW);
    expect(verifyTicket(`k1${token.slice(2)}`, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a flip of every character', () => {
    const { token } = issueTicket(request, NOW);
    for (let at = 0; at < token.length; at++) {
      if (token.charAt(at) === '.') continue;
      expect(verifyTicket(flipChar(token, at), NOW).ok, `flip at ${at}`).toBe(false);
    }
  });

  it('rejects a flip of every bit in the MAC, spare bits included', () => {
    const { token } = issueTicket(request, NOW);
    const macStart = token.lastIndexOf('.') + 1;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let at = macStart; at < token.length; at++) {
      const value = alphabet.indexOf(token.charAt(at));
      for (let bit = 0; bit < 6; bit++) {
        const flipped = token.slice(0, at) + alphabet.charAt(value ^ (1 << bit)) + token.slice(at + 1);
        expect(verifyTicket(flipped, NOW).ok, `bit ${bit} at ${at}`).toBe(false);
      }
    }
  });

  it('rejects a payload rewritten by someone without the secret', () => {
    const { ticket } = issueTicket(request, NOW);
    const forged = forge('k2', { ...ticket, amount: 15 }, 'not-the-secret-not-the-secret-not-the-secret');
    expect(verifyTicket(forged, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a correctly signed payload that breaks the shape', () => {
    const { ticket } = issueTicket(request, NOW);
    const cases: unknown[] = [
      { ...ticket, v: 2 },
      { ...ticket, amount: 61 },
      { ...ticket, pack: 'pt-1k@1' },
      { ...ticket, seed: 'xyz' },
      { ...ticket, exp: ticket.iat },
      { ...ticket, user: 'someone' },
    ];
    for (const payload of cases) expect(verifyTicket(forge('k2', payload, SECRET_B), NOW)).toEqual({ ok: false, reason: 'bad-payload' });
  });

  it('rejects malformed tokens', () => {
    const good = issueTicket(request, NOW).token;
    const cases: unknown[] = [
      undefined,
      null,
      42,
      '',
      '.',
      '..',
      'a.b',
      `${good}.extra`,
      'k2.!!!.!!!',
      `K2${good.slice(2)}`,
      'k2.e30.c2hvcnQ',
      'x'.repeat(5000),
      `k2.${'A'.repeat(3000)}.${'A'.repeat(43)}`,
    ];
    for (const token of cases) expect(verifyTicket(token, NOW)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('rejects a signed token whose payload is not JSON', () => {
    const body = Buffer.from('not json').toString('base64url');
    const mac = createHmac('sha256', SECRET_B).update(`ticket.k2.${body}`).digest('base64url');
    expect(verifyTicket(`k2.${body}.${mac}`, NOW)).toEqual({ ok: false, reason: 'bad-payload' });
  });

  it('refuses to work with no secrets or weak ones, without echoing them', () => {
    delete process.env.TICKET_SECRETS;
    expect(() => issueTicket(request, NOW)).toThrow(TicketConfigError);
    process.env.TICKET_SECRETS = 'k1:short-value';
    expect(() => issueTicket(request, NOW)).toThrow(TicketConfigError);
    expect(() => issueTicket(request, NOW)).not.toThrow(/short-value/);
    process.env.TICKET_SECRETS = `k1:${SECRET_A},k1:${SECRET_B}`;
    expect(() => verifyTicket('k1.a.b', NOW)).not.toThrow();
    expect(() => issueTicket(request, NOW)).toThrow(TicketConfigError);
  });
});

describe('stamps', () => {
  const saved = process.env.TICKET_SECRETS;
  beforeEach(() => {
    process.env.TICKET_SECRETS = `k2:${SECRET_B}`;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TICKET_SECRETS;
    else process.env.TICKET_SECRETS = saved;
  });

  it('carries the server clock for its nonce and phase', () => {
    const { token, ticket } = issueTicket(request, NOW);
    const stamp = issueStamp(token, 'start', NOW + 5000);
    expect(verifyStamp(stamp, ticket.nonce, 'start')).toBe(NOW + 5000);
  });

  it('does not verify for another nonce or phase', () => {
    const { token, ticket } = issueTicket(request, NOW);
    const other = issueTicket(request, NOW).ticket;
    const stamp = issueStamp(token, 'start', NOW);
    expect(verifyStamp(stamp, other.nonce, 'start')).toBeNull();
    expect(verifyStamp(stamp, ticket.nonce, 'end')).toBeNull();
  });

  it('gives a start stamp only on a live ticket, and an end stamp on any genuine one', () => {
    const { token } = issueTicket(request, NOW);
    const late = NOW + TICKET_TTL_MS + 1;
    expect(issueStamp(token, 'start', late)).toBeNull();
    expect(issueStamp(token, 'end', late)).not.toBeNull();
    expect(issueStamp('garbage', 'end', NOW)).toBeNull();
  });

  it('cannot pass a stamp as a ticket or a ticket as a stamp', () => {
    const { token, ticket } = issueTicket(request, NOW);
    const stamp = issueStamp(token, 'start', NOW);
    expect(readTicket(stamp)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyStamp(token, ticket.nonce, 'start')).toBeNull();
  });

  it('rejects a flip of any character', () => {
    const { token, ticket } = issueTicket(request, NOW);
    const stamp = issueStamp(token, 'end', NOW) ?? '';
    for (let at = 0; at < stamp.length; at++) {
      if (stamp.charAt(at) === '.') continue;
      expect(verifyStamp(flipChar(stamp, at), ticket.nonce, 'end'), `flip at ${at}`).toBeNull();
    }
  });
});

describe('a ticket requested by a client', () => {
  const saved = process.env.TICKET_SECRETS;
  beforeAll(() => {
    process.env.TICKET_SECRETS = 'k1:test-only-secret-test-only-secret-test-only';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TICKET_SECRETS;
    else process.env.TICKET_SECRETS = saved;
  });

  it('gives the plan’s modes on any pack in its language', () => {
    const issued = issueFreeTicket({ pack: 'en-1k@1', mode: 'time', amount: 60 }, NOW);
    expect(issued?.ticket).toMatchObject({ language: 'en', pack: 'en-1k@1', mode: 'time', amount: 60, iat: NOW });
    expect(issued?.ticket.day).toBeUndefined();
    expect(issueFreeTicket({ pack: 'pt-5k@1', mode: 'words', amount: 100 }, NOW)?.ticket.language).toBe('pt');
  });

  it.each([
    ['today’s seed', { pack: 'en-1k@1', mode: 'time', amount: 60, seed: 'a'.repeat(32) }],
    ['a nonce of its choosing', { pack: 'en-1k@1', mode: 'time', amount: 60, nonce: '00000000-0000-4000-8000-000000000000' }],
    ['a day', { pack: 'en-1k@1', mode: 'time', amount: 60, day: '2026-11-06' }],
    ['a mode that doesn’t exist', { pack: 'en-1k@1', mode: 'time', amount: 61 }],
    ['a pack that doesn’t exist', { pack: 'en-9k@1', mode: 'time', amount: 60 }],
    ['a pack named like an inherited key', { pack: '__proto__', mode: 'time', amount: 60 }],
    ['nothing', {}],
    ['no object at all', null],
    ['a string', 'en-1k@1'],
  ])('refuses %s', (_name, request) => {
    expect(issueFreeTicket(request, NOW)).toBeNull();
  });
});
