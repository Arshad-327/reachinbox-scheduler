import { z } from 'zod';

/**
 * Upper bound on recipients accepted in ONE request.
 *
 * 5000 is a deliberate request-size guard, not a product limit: at ~100 bytes
 * per recipient that is roughly half a megabyte of JSON, which still fits
 * comfortably inside the 2mb body cap and inside a single Postgres
 * createMany. A real system would not raise this number — it would change
 * shape: accept an uploaded file reference, stream/chunk it server-side, and
 * report progress asynchronously, so one HTTP request never has to hold an
 * entire list in memory.
 */
export const MAX_RECIPIENTS_PER_REQUEST = 5000;

export const recipientSchema = z.object({
  email: z.string().trim().email('must be a valid email address'),
  name: z.string().trim().max(200).optional(),
});

export const scheduleCampaignSchema = z.object({
  subject: z.string().trim().min(1, 'subject is required').max(500),
  bodyHtml: z.string().min(1, 'bodyHtml is required').max(100_000),
  /** ISO-8601 in, Date out — every downstream consumer wants a Date. */
  startTime: z.coerce.date({ message: 'startTime must be an ISO-8601 datetime' }),
  delayBetweenMs: z.coerce.number().int().min(0).max(3_600_000),
  hourlyLimit: z.coerce.number().int().min(1).max(10_000),
  recipients: z
    .array(recipientSchema)
    .min(1, 'at least one recipient is required')
    .max(MAX_RECIPIENTS_PER_REQUEST, `at most ${MAX_RECIPIENTS_PER_REQUEST} recipients per request`),
});

export type ScheduleCampaignBody = z.infer<typeof scheduleCampaignSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const idParamSchema = z.object({
  id: z.string().min(1),
});

const emailStatusEnum = z.enum([
  'SCHEDULED',
  'QUEUED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED',
]);

/** Filters shared by the scheduled and sent list views. */
export const emailListQuerySchema = paginationSchema.extend({
  campaignId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  /** Comma-separated, e.g. ?status=SENT,FAILED. Narrows the view's default set. */
  status: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) {
        return undefined;
      }
      const parts = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const parsed = z.array(emailStatusEnum).safeParse(parts);
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          message: `must be a comma-separated list of: ${emailStatusEnum.options.join(', ')}`,
        });
        return z.NEVER;
      }
      return parsed.data;
    }),
});

export type EmailListQuery = z.infer<typeof emailListQuerySchema>;
