import { describe, expect, it } from 'vitest';

import { CLI_SCOPES, buildAuthorizeUrl, challengeFor, createPkce, randomState } from '../src/oauth.js';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('creates a 43-character unreserved verifier and its S256 challenge', () => {
    const p = createPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(p.verifier).toHaveLength(43);
    expect(p.challenge).toBe(challengeFor(p.verifier));
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.method).toBe('S256');
  });

  it('never repeats a verifier or state', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(createPkce().verifier);
      seen.add(randomState());
    }
    expect(seen.size).toBe(400);
  });

  it('builds the authorization URL with S256 and the CLI scopes', () => {
    const url = new URL(
      buildAuthorizeUrl(
        { issuer: 'https://rightis.org', authorization_endpoint: 'https://rightis.org/oauth/authorize', token_endpoint: 'https://rightis.org/api/oauth/token' },
        { clientId: 'cid', redirectUri: 'http://127.0.0.1:5555/callback', state: 'st', challenge: 'ch' },
      ),
    );
    expect(url.origin + url.pathname).toBe('https://rightis.org/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:5555/callback',
      scope: CLI_SCOPES,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(CLI_SCOPES).toBe('console:manage rights:check');
  });
});
