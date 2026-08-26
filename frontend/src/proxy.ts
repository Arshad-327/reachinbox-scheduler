import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

/**
 * Route protection.
 *
 * NOTE ON THE FILENAME: this is what earlier Next.js versions called
 * `middleware.ts`. Next.js 16 renamed the convention to `proxy.ts` with a
 * `proxy` (or default) export -- `middleware.ts` still runs but is deprecated,
 * so this project uses the current name. Same file position (next to `app/`),
 * same semantics, same `config.matcher`.
 * See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * This is an optimistic check, exactly as the Next docs prescribe: it looks at
 * the session cookie and redirects, nothing more. It is NOT the authorisation
 * boundary -- that is the backend, which validates its own JWT on every request
 * regardless of what got past this file.
 */

/** Paths that must stay reachable with no session. */
const PUBLIC_PATHS = ['/login'];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // NextAuth's own endpoints (sign-in, the Google callback, session polling)
  // must never be redirected -- doing so breaks the very flow that creates the
  // session. The matcher below also excludes them; this is the belt to that
  // pair of braces.
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  // A session with no backendToken is treated as no session at all. The jwt
  // callback makes that combination impossible to create, but if one ever
  // exists (a cookie from an older build, say) bouncing the user to /login is
  // far better than letting them into a UI whose every request 401s.
  const isAuthenticated = Boolean(req.auth?.backendToken);

  if (!isAuthenticated && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }

  if (isAuthenticated && isPublic) {
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/auth      - NextAuth's own routes
     *   _next/static  - build output
     *   _next/image   - the image optimizer
     *   favicon.ico   - and any other file with an extension in public/
     *
     * Without a matcher, proxy runs on every request including static assets,
     * and the redirect above would happily block the page's own CSS.
     */
    '/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\.[\\w]+$).*)',
  ],
};
