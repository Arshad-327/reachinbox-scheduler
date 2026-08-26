import type { CampaignStatus, EmailStatus } from '@prisma/client';

export type { CampaignStatus, EmailStatus };

/** Payload accepted by POST /campaigns to schedule a new campaign. */
export interface ScheduleCampaignInput {
  senderId: string;
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

export interface RecipientInput {
  email: string;
  name?: string | null;
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
   * First ~160 characters of the body as plain text, for the dashboard's
   * one-line row preview. Truncated HERE rather than client-side so a list of
   * 25 rows does not ship 25 full HTML bodies to render 25 short strings.
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

/** Per-status counts for a campaign's jobs, used by the dashboard summary. */
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
 * Flat pagination envelope. The page metadata sits alongside `data` rather
 * than nested under `meta` so the frontend can read `total`/`totalPages`
 * without an extra hop.
 */
export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** The authenticated principal attached to `req.user` by requireAuth. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Public shape of a User returned by the auth routes. */
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

/** Verified claims lifted out of a Google ID token. */
export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Standard error envelope returned by the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
