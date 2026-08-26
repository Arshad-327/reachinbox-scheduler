/**
 * Wire types for the scheduler API.
 *
 * SOURCE OF TRUTH: backend/src/types/index.ts (plus the two service-local
 * shapes noted below). These are hand-mirrored rather than generated, so when
 * a backend DTO changes, change it there first and then reflect it here.
 *
 *   EmailJobDTO, CampaignDTO, CampaignJobCounts,
 *   PaginatedResponse<T>, ScheduleCampaignInput, RecipientInput,
 *   UserDTO, ApiErrorBody      -> backend/src/types/index.ts
 *   StatsResponse (EmailStats) -> backend/src/services/emailJob.service.ts
 *   UploadResult               -> backend/src/routes/upload.routes.ts
 *   SystemLimits               -> backend/src/routes/system.routes.ts
 *
 * Every timestamp crosses the wire as an ISO-8601 string, never a Date.
 */

/** Prisma enum EmailStatus, mirrored as a union. */
export type EmailStatus =
  | 'SCHEDULED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

/** Prisma enum CampaignStatus, mirrored as a union. */
export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED';

/** Public shape of a User returned by the auth routes. */
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

/** Response body of POST /api/auth/google. */
export interface GoogleAuthResponse {
  /** The backend's own JWT — this is what authorises every later API call. */
  token: string;
  user: UserDTO;
}

/** A single scheduled/sent email as returned to the dashboard. */
export interface EmailJobDTO {
  id: string;
  campaignId: string;
  senderId: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  /**
   * First ~160 characters of the body as plain text. Computed server-side
   * (toBodyPreview in backend/src/services/emailJob.service.ts) so the list
   * response does not carry full HTML bodies.
   */
  bodyPreview: string;
  status: EmailStatus;
  /** ISO-8601. Authoritative send time. */
  scheduledAt: string;
  /** ISO-8601, null until the send succeeds. */
  sentAt: string | null;
  sequence: number;
  attempts: number;
  maxAttempts: number;
  messageId: string | null;
  previewUrl: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-status counts for a campaign's jobs. */
export type CampaignJobCounts = Record<EmailStatus, number>;

export interface CampaignDTO {
  id: string;
  userId: string;
  senderId: string;
  subject: string;
  bodyHtml: string;
  status: CampaignStatus;
  /** ISO-8601. */
  startTime: string;
  delayBetweenMs: number;
  hourlyLimit: number;
  totalRecipients: number;
  counts: CampaignJobCounts;
  createdAt: string;
  updatedAt: string;
}

/**
 * Flat pagination envelope — the backend deliberately keeps page metadata
 * alongside `data` rather than nested under `meta`, so read `total` and
 * `totalPages` straight off the response.
 */
export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** GET /api/emails/stats — the sidebar badge counts. */
export interface StatsResponse {
  byStatus: Record<EmailStatus, number>;
  scheduled: number;
  sent: number;
  total: number;
  campaigns: number;
}

export interface RecipientInput {
  email: string;
  /**
   * OPTIONAL, not nullable. backend/src/types/index.ts declares this
   * `string | null`, but the zod schema that actually validates the request
   * (recipientSchema) is `z.string().trim().max(200).optional()` — sending an
   * explicit null is rejected with a 400 on `recipients.N.name`. The schema
   * wins, so this mirrors the schema.
   */
  name?: string;
}

/**
 * POST /api/campaigns body.
 *
 * NOTE: there is deliberately no `senderId` here. The backend round-robins
 * across the active Sender rows itself (pickSenderForCampaign in
 * campaign.service.ts) and persists the choice per job, so the client never
 * names a sender. See scheduleCampaignSchema in backend/src/schemas/index.ts.
 */
export interface ScheduleCampaignInput {
  subject: string;
  bodyHtml: string;
  /** ISO-8601 timestamp for when the first email goes out. */
  startTime: string;
  /** Spacing between consecutive sends, in milliseconds. */
  delayBetweenMs: number;
  /** Per-campaign hourly cap chosen by the user. */
  hourlyLimit: number;
  recipients: RecipientInput[];
}

/**
 * POST /api/uploads/recipients — stateless parse result. Nothing is persisted
 * server-side; the client holds `recipients` and posts them back inside
 * ScheduleCampaignInput.
 */
export interface UploadResult {
  mode: 'csv-with-header' | 'bare-list';
  /** Rows seen in the file, before validation. */
  total: number;
  /** Rows that survived validation and de-duplication. */
  valid: number;
  invalid: number;
  duplicates: number;
  /** Up to five rejected addresses, for showing the user what went wrong. */
  invalidSamples: string[];
  recipients: RecipientInput[];
}

/** One rate-limit scope's live counter (ScopePeek in rateLimit.service.ts). */
export interface ScopePeek {
  scope: string;
  count: number;
  limit: number;
  remaining: number;
  ttlSeconds: number;
}

/** One sender's slice of GET /api/system/limits. */
export interface SenderLimitView {
  senderId: string;
  email: string;
  fromName: string;
  hourlyLimit: number;
  limitSource: 'env-default' | 'sender-override';
  /** Live Redis counters, one entry per scope the strategy applies. */
  scopes: ScopePeek[];
}

/** GET /api/system/limits. */
export interface SystemLimits {
  config: {
    strategy: 'per_sender' | 'global' | 'both';
    maxEmailsPerHourPerSender: number;
    maxEmailsPerHourGlobal: number;
    minDelayBetweenEmailsMs: number;
    workerConcurrency: number;
    maxJobAttempts: number;
  };
  window: {
    /** ISO-8601, or null when no sender is configured. */
    start: string | null;
    resetsInMs: number | null;
    resetsAt: string | null;
  };
  /** Config plus live counters for every active sender. */
  senders: SenderLimitView[];
}

/** 201 response of POST /api/campaigns. */
export interface CreateCampaignResult {
  campaign: CampaignDTO;
  /** How many recipients were dropped as case-insensitive duplicates. */
  duplicatesDropped: number;
  enqueued: number;
}

/** The error envelope every non-2xx backend response carries. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
