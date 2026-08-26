/**
 * Module augmentation so `session.backendToken` and `token.backendToken` are
 * typed rather than `any`.
 *
 * Two separate targets, and they are not interchangeable:
 *   - `next-auth`      -> the Session the client sees via useSession()/auth()
 *   - `@auth/core/jwt` -> the encrypted JWT the `jwt` callback passes along
 *
 * This file only declares types; importing anything from it at runtime is a
 * mistake. `import type` below keeps it erasable.
 */
import type { DefaultSession } from 'next-auth';
import type { UserDTO } from '@/types/api';

/**
 * The user as the backend knows it — exactly the shape POST /api/auth/google
 * returns. Aliased rather than re-declared so the two cannot drift.
 */
export type BackendUser = UserDTO;

declare module 'next-auth' {
  interface Session {
    /**
     * The BACKEND's JWT, not Google's and not NextAuth's own session token.
     * Every call to the scheduler API carries this as `Authorization: Bearer`.
     * It is always present: a session without one is never created (see the
     * jwt callback in src/lib/auth.ts).
     */
    backendToken: string;
    user: {
      id: string;
      avatarUrl: string | null;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    backendToken: string;
    backendUser: BackendUser;
  }
}
