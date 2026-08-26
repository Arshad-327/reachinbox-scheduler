import type { AuthUser } from './index.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, from X-Request-Id or generated per request. */
      requestId: string;
      /** Set by requireAuth. Present only on protected routes. */
      user?: AuthUser;
      /**
       * Output of the `validate()` middleware. Populated only for the parts
       * a route actually declared a schema for. Cast at the route boundary:
       * `req.validated.body as z.infer<typeof schema>`.
       */
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
