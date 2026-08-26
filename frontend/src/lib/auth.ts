import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

import type { GoogleAuthResponse } from '@/types/api';

/**
 * Auth wiring.
 *
 * NextAuth owns the Google handshake and nothing else. The moment Google hands
 * back an ID token we trade it with our own backend for OUR jwt, and that
 * backend token -- not Google's, not NextAuth's session cookie -- is what
 * authorises every subsequent API call.
 *
 *   browser  -> Google    consent, returns account.id_token
 *   NextAuth -> backend   POST /api/auth/google { idToken }
 *   backend  -> NextAuth  { token, user }   <- our JWT
 *   client   -> backend   Authorization: Bearer <token>
 *
 * No database adapter: the backend owns the users table (it upserts on
 * googleId inside POST /api/auth/google), so a second store here would be a
 * second source of truth. That forces `strategy: "jwt"` -- with no adapter the
 * database strategy has nowhere to write.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  // Fail at import time rather than inside the callback: a missing API URL
  // means every sign-in would fail anyway, and failing here names the cause.
  throw new Error('NEXT_PUBLIC_API_URL is not set - cannot exchange Google tokens');
}

/**
 * The backend's JWT lives for 7 days (TOKEN_TTL in
 * backend/src/services/auth.service.ts). Keeping the NextAuth session at the
 * same age means the cookie and the token it carries expire together; a longer
 * NextAuth session would leave the user "logged in" holding a backend token
 * the API has already started rejecting.
 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Give up rather than hang the OAuth callback on an unreachable backend. */
const EXCHANGE_TIMEOUT_MS = 10_000;

/**
 * Trades a Google ID token for the backend's own JWT.
 *
 * Throws on any failure. That is deliberate and it is the whole point of this
 * function -- see the jwt callback below.
 */
async function exchangeGoogleIdToken(idToken: string): Promise<GoogleAuthResponse> {
  const res = await fetch(`${API_URL}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });

  if (!res.ok) {
    // The backend's error envelope is { error: { code, message, details } }.
    // Surface its message in the server log; a 401 here almost always means
    // the frontend and backend disagree about GOOGLE_CLIENT_ID, since the
    // backend verifies the token's `aud` claim against its own copy.
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const detail = body?.error
      ? `${body.error.code ?? 'UNKNOWN'}: ${body.error.message ?? '(no message)'}`
      : '(no error envelope in response body)';

    throw new Error(`Backend rejected the Google ID token (HTTP ${res.status}) - ${detail}`);
  }

  const data = (await res.json()) as GoogleAuthResponse;

  if (!data?.token || !data?.user?.id) {
    throw new Error('Backend returned 200 but no { token, user } - refusing to build a session');
  }

  return data;
}

export const authConfig: NextAuthConfig = {
  // Explicit rather than relying on AUTH_SECRET, so the var names here match
  // the ones already in .env.local and backend/.env.
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openid email profile',
          // The backend verifies a fresh ID token on every sign-in, so let the
          // user pick an account rather than silently reusing a Google session.
          prompt: 'select_account',
        },
      },
    }),
  ],

  session: {
    // No adapter -> no database strategy available. The backend is the store.
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  pages: {
    signIn: '/login',
    // Send auth errors to the login page as ?error=<code> so the banner there
    // renders them, instead of NextAuth's own /api/auth/error page.
    error: '/login',
  },

  callbacks: {
    /**
     * Runs on every session read, but `account` is only populated on the first
     * call of a sign-in. That first call is where the exchange happens.
     */
    async jwt({ token, account, trigger }) {
      if (account?.provider === 'google' && trigger === 'signIn') {
        // `account.id_token` is GOOGLE's ID token -- the thing the backend
        // verifies against Google's public keys. Not to be confused with
        // `account.access_token` (for calling Google's own APIs, which we never
        // do) or with the backend token we are about to receive.
        const idToken = account.id_token;

        if (!idToken) {
          throw new Error(
            'Google returned no id_token - check that the "openid" scope is requested',
          );
        }

        // THROWING HERE IS INTENTIONAL - DO NOT SOFTEN IT.
        //
        // If the exchange fails and we swallow it (return the token unchanged,
        // or return null quietly), NextAuth still holds a perfectly valid
        // Google identity and would happily mint a session cookie carrying no
        // backendToken. The user then lands on the dashboard looking logged in
        // while every single API call 401s -- a failure that surfaces far from
        // its cause and is miserable to diagnose.
        //
        // Throwing aborts the callback route: no session cookie is written, the
        // real reason is logged server-side in full, and the browser is
        // redirected to /login?error=... where the banner tells the user
        // sign-in failed. Loud, immediate, and at the point of failure.
        const { token: backendToken, user } = await exchangeGoogleIdToken(idToken);

        token.backendToken = backendToken;
        token.backendUser = user;

        // Keep the standard claims aligned with the backend's copy of the user,
        // so anything reading token.email sees the value the API attributes
        // requests to.
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.avatarUrl;
      }

      return token;
    },

    /**
     * Project the JWT onto the session object the client actually sees.
     * `backendToken` is surfaced so useApi() can attach it; nothing else from
     * the JWT is exposed.
     */
    async session({ session, token }) {
      session.backendToken = token.backendToken;
      session.user = {
        ...session.user,
        id: token.backendUser.id,
        name: token.backendUser.name,
        email: token.backendUser.email,
        avatarUrl: token.backendUser.avatarUrl,
        // `image` is NextAuth's own field; mirror the avatar into it so stock
        // NextAuth UI keeps working.
        image: token.backendUser.avatarUrl,
      };

      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export const { GET, POST } = handlers;
