import 'dotenv/config';
import { z } from 'zod';

/**
 * One SMTP sender identity. SMTP_ACCOUNTS is supplied as a JSON string in the
 * environment and parsed into an array of these.
 */
const smtpAccountSchema = z.object({
  user: z.string().min(1),
  pass: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  fromName: z.string().min(1),
});

export type SmtpAccount = z.infer<typeof smtpAccountSchema>;

const smtpAccountsSchema = z.string().transform((raw, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a valid JSON string' });
    return z.NEVER;
  }

  const result = z.array(smtpAccountSchema).min(1).safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    ctx.addIssue({
      code: 'custom',
      message: `must be a JSON array of { user, pass, host, port, fromName } (${detail})`,
    });
    return z.NEVER;
  }

  return result.data;
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  JWT_SECRET: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().nonnegative().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(100),
  MAX_EMAILS_PER_HOUR_GLOBAL: z.coerce.number().int().positive().default(500),
  RATE_LIMIT_STRATEGY: z.enum(['per_sender', 'global', 'both']).default('per_sender'),

  SMTP_ACCOUNTS: smtpAccountsSchema,

  MAX_JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),

  /**
   * How stale a PROCESSING row's lockedAt must be before boot reconciliation
   * treats it as abandoned. MUST exceed the worker's lockDuration (60s) --
   * see the comment in reconciliation.service.ts.
   */
  STUCK_JOB_THRESHOLD_MS: z.coerce.number().int().positive().default(120_000),

  /** Escape hatch: skip the one-shot boot reconciliation pass. */
  RECONCILE_ON_BOOT: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const name = issue.path.join('.') || '<root>';
      const missing = issue.code === 'invalid_type' && process.env[name] === undefined;
      return `  - ${name}: ${missing ? 'is required but was not set' : issue.message}`;
    });

    throw new Error(
      [
        'Invalid environment configuration. Fix the following and restart:',
        ...lines,
        '',
        'Tip: copy backend/.env.example to backend/.env and fill in the blanks.',
      ].join('\n'),
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
