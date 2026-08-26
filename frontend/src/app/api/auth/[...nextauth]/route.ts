/**
 * The NextAuth catch-all route. Everything under /api/auth/* is served here:
 * /api/auth/signin, /api/auth/callback/google, /api/auth/session, /api/auth/signout.
 *
 * Because the callback lives at /api/auth/callback/google, the Authorised
 * redirect URI registered in the Google Cloud Console must be exactly
 * http://localhost:3000/api/auth/callback/google in development.
 */
export { GET, POST } from '@/lib/auth';
