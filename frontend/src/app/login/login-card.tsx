'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

import { GoogleIcon } from './google-icon';

/**
 * NextAuth reports failures by redirecting to pages.error (we point that at
 * /login) with ?error=<code>. The codes are Auth.js's own; anything thrown
 * inside our jwt callback -- including a backend that refuses the Google ID
 * token -- surfaces as Configuration or CallbackRouteError, with the real
 * reason printed in the `next dev` server log.
 */
const ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    'Sign-in failed while contacting the scheduler API. Check that the backend is running on port 4000, then try again.',
  CallbackRouteError:
    'Sign-in failed while contacting the scheduler API. Check that the backend is running on port 4000, then try again.',
  AccessDenied: 'That Google account was refused. Try a different account.',
  OAuthAccountNotLinked: 'That email is already registered through another provider.',
  OAuthCallbackError: 'Google cancelled the sign-in. Please try again.',
  Verification: 'That sign-in link is no longer valid. Please try again.',
};

function messageFor(code: string): string {
  return (
    ERROR_MESSAGES[code] ??
    `Sign-in failed (${code}). Check the server log for the underlying error.`
  );
}

export function LoginCard({ error }: { error?: string }) {
  // Stays true once set: signIn() navigates away from this page, so there is
  // no success path that needs to clear it. Only a failed redirect resets it.
  const [signingIn, setSigningIn] = useState(false);

  async function handleGoogleSignIn() {
    setSigningIn(true);
    try {
      await signIn('google', { callbackUrl: '/' });
    } catch {
      // signIn() normally never returns -- it replaces the document. If it does
      // return, the redirect never happened, so give the button back.
      setSigningIn(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page-bg px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="rounded-2xl border border-border-subtle bg-surface px-8 py-9 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.12)]">
          <h1 className="text-center text-[28px] font-bold leading-tight tracking-tight text-foreground">
            Login
          </h1>

          {error ? (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-danger-border bg-danger-bg px-3.5 py-3 text-[13px] leading-relaxed text-danger"
            >
              {messageFor(error)}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={signingIn}
            className="mt-7 flex w-full items-center justify-center gap-3 rounded-lg bg-brand-green-light px-4 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-brand-green-light-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green disabled:cursor-wait disabled:opacity-70"
          >
            {signingIn ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                />
                Redirecting to Google…
              </>
            ) : (
              <>
                <GoogleIcon className="h-[18px] w-[18px] shrink-0" />
                Login with Google
              </>
            )}
          </button>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border-subtle" />
            <span className="shrink-0 text-[13px] text-text-muted">
              or sign up through email
            </span>
            <span className="h-px flex-1 bg-border-subtle" />
          </div>

          {/*
            DECORATIVE ONLY. The assignment requires real Google OAuth, and the
            backend has exactly one credential path: POST /api/auth/google,
            which verifies a Google ID token. There is no password to check
            against, so these are rendered disabled rather than wired to a
            credentials provider that would have to fake an identity.
          */}
          <fieldset disabled aria-describedby="email-signup-note" className="space-y-3">
            <legend className="sr-only">Email sign-up (not available)</legend>

            <input
              type="email"
              name="email"
              placeholder="Email ID"
              autoComplete="off"
              title="Google sign-in is required — email sign-up is not available."
              className="w-full cursor-not-allowed rounded-lg border border-border-input bg-surface-muted px-4 py-3 text-[15px] text-foreground placeholder:text-text-muted"
            />

            <input
              type="password"
              name="password"
              placeholder="Password"
              autoComplete="off"
              title="Google sign-in is required — email sign-up is not available."
              className="w-full cursor-not-allowed rounded-lg border border-border-input bg-surface-muted px-4 py-3 text-[15px] text-foreground placeholder:text-text-muted"
            />

            <button
              type="button"
              title="Google sign-in is required — email sign-up is not available."
              className="w-full cursor-not-allowed rounded-lg bg-brand-green px-4 py-3 text-[15px] font-semibold text-white"
            >
              Login
            </button>
          </fieldset>

          <p
            id="email-signup-note"
            className="mt-4 text-center text-[12px] leading-relaxed text-text-muted"
          >
            Email sign-up is not enabled — use Google sign-in.
          </p>
        </div>
      </div>
    </main>
  );
}
