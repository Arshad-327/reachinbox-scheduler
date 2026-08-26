'use client';

import { useMemo } from 'react';
import { useSession } from 'next-auth/react';

import type { ApiErrorBody } from '@/types/api';

/**
 * The only module in the app that calls fetch().
 *
 * Everything else goes through apiGet/apiPost/apiDelete/apiUpload, or through
 * the useApi() hook, which binds the session's backend token so components
 * never touch a token themselves. Keeping fetch in one place means the
 * Authorization header, the error envelope and the JSON parsing all have
 * exactly one implementation to get right.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * A failed API call, carrying everything the backend told us.
 *
 * The backend's envelope is { error: { code, message, details } } -- see
 * backend/src/middleware/errorHandler.ts. `code` is the stable machine-readable
 * discriminator (UNAUTHORIZED, RATE_LIMITED, VALIDATION_ERROR, ...); `message`
 * is safe to show a user; `details` is whatever context that error type
 * attached, e.g. Zod issues on a validation failure.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /** The request that failed, for logs. */
  readonly path: string;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    path: string;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.path = args.path;
  }

  /** The session is gone or the backend token expired -- send them to /login. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

interface RequestOptions {
  /** The backend JWT. Omitted only for endpoints that genuinely need no auth. */
  token?: string | null;
  /** Appended as a query string; undefined and null values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, BASE_URL);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

/**
 * Turns any non-2xx response into an ApiError. Never returns normally for a
 * failed response, and never swallows one -- a caller that ignores the promise
 * rejection is the only way an error goes unnoticed.
 */
async function toApiError(res: Response, path: string): Promise<ApiError> {
  let body: unknown = null;

  try {
    body = await res.json();
  } catch {
    // A non-JSON body means something upstream of the API answered -- a proxy,
    // a crashed process, an HTML error page. Fall through to the generic case
    // below rather than pretending we parsed an envelope.
  }

  const envelope = body as ApiErrorBody | null;

  if (envelope?.error?.message) {
    return new ApiError({
      status: res.status,
      code: envelope.error.code ?? 'UNKNOWN',
      message: envelope.error.message,
      details: envelope.error.details,
      path,
    });
  }

  return new ApiError({
    status: res.status,
    code: 'NON_JSON_RESPONSE',
    message: `${res.status} ${res.statusText || 'Request failed'} from ${path}`,
    path,
  });
}

async function request<T>(
  method: string,
  path: string,
  { token, query, signal }: RequestOptions,
  body?: BodyInit,
  contentType?: string,
): Promise<T> {
  const url = buildUrl(path, query);
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  let res: Response;

  try {
    res = await fetch(url, { method, headers, body, signal });
  } catch (err) {
    // A transport failure -- backend down, DNS, CORS, aborted. Re-thrown as an
    // ApiError so callers have exactly one error type to handle, with status 0
    // marking "the request never got an answer".
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message:
        err instanceof Error
          ? `Could not reach the API at ${BASE_URL}: ${err.message}`
          : `Could not reach the API at ${BASE_URL}`,
      path,
    });
  }

  if (!res.ok) {
    throw await toApiError(res, path);
  }

  // 204 and friends carry no body; T is expected to be void at those callsites.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', path, options);
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return request<T>(
    'POST',
    path,
    options,
    body === undefined ? undefined : JSON.stringify(body),
    'application/json',
  );
}

export function apiDelete<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('DELETE', path, options);
}

/**
 * multipart/form-data upload. The Content-Type header is deliberately NOT set:
 * the browser has to generate it itself so it can append the multipart
 * boundary. Setting it by hand produces a body multer cannot parse.
 */
export function apiUpload<T>(
  path: string,
  file: File,
  options: RequestOptions & { fieldName?: string } = {},
): Promise<T> {
  const form = new FormData();
  // The backend reads upload.single('file') -- the field name must be "file".
  form.append(options.fieldName ?? 'file', file);

  return request<T>('POST', path, options, form);
}

/** The token-bound surface components use. Same methods, no token argument. */
export interface BoundApi {
  get: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  del: <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;
  upload: <T>(
    path: string,
    file: File,
    options?: Omit<RequestOptions, 'token'> & { fieldName?: string },
  ) => Promise<T>;
  /** False until the session has loaded; calling before then will 401. */
  ready: boolean;
}

/**
 * Pulls the backend token off the NextAuth session and returns bound methods.
 *
 * Components never see a token: they call `api.get<StatsResponse>(...)` and the
 * Authorization header is somebody else's problem. `ready` is false while
 * useSession() is still resolving -- gate effects on it so the first render
 * does not fire an unauthenticated request.
 */
export function useApi(): BoundApi {
  const { data: session, status } = useSession();
  const token = session?.backendToken ?? null;

  return useMemo<BoundApi>(
    () => ({
      get: (path, options) => apiGet(path, { ...options, token }),
      post: (path, body, options) => apiPost(path, body, { ...options, token }),
      del: (path, options) => apiDelete(path, { ...options, token }),
      upload: (path, file, options) => apiUpload(path, file, { ...options, token }),
      ready: status === 'authenticated' && Boolean(token),
    }),
    [token, status],
  );
}
