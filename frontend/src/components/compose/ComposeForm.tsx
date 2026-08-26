'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronDown, Clock, Paperclip } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError, useApi } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { isHtmlEmpty, sanitizeHtml } from '@/lib/sanitize-html';
import { useStatsContext } from '@/hooks/stats-context';
import { useSystemLimits } from '@/hooks/useSystemLimits';
import { Button } from '@/components/ui/Button';
import type { CreateCampaignResult, ScheduleCampaignInput } from '@/types/api';
import { FieldRow } from './FieldRow';
import { RecipientInput, type Recipient } from './RecipientInput';
import { RichTextEditor } from './RichTextEditor';
import { SendLaterPopover } from './SendLaterPopover';
import { UploadListButton } from './UploadListButton';

/**
 * With no schedule chosen, "Send" means "as soon as the worker can". Ten
 * seconds rather than `now` because the API rejects a startTime in the past
 * and the round trip plus clock skew can easily eat a second or two.
 */
const SEND_NOW_LEAD_MS = 10_000;

interface FieldErrors {
  recipients?: string;
  subject?: string;
  bodyHtml?: string;
  delayBetweenMs?: string;
  hourlyLimit?: string;
  startTime?: string;
}

/**
 * Maps the backend's error envelope onto form fields.
 *
 * `details` is Record<dottedPath, string[]> — "subject", "hourlyLimit",
 * "recipients", and per-item paths like "recipients.0.email". Everything under
 * `recipients.*` collapses onto the one To field, since that is where the user
 * would go to fix it.
 */
function mapBackendErrors(details: unknown): FieldErrors {
  if (!details || typeof details !== 'object') return {};

  const entries = Object.entries(details as Record<string, unknown>);
  const mapped: FieldErrors = {};

  for (const [path, messages] of entries) {
    const message = Array.isArray(messages) ? String(messages[0]) : String(messages);
    const root = path.split('.')[0];

    switch (root) {
      case 'subject':
        mapped.subject ??= message;
        break;
      case 'bodyHtml':
        mapped.bodyHtml ??= message;
        break;
      case 'delayBetweenMs':
        mapped.delayBetweenMs ??= message;
        break;
      case 'hourlyLimit':
        mapped.hourlyLimit ??= message;
        break;
      case 'startTime':
        mapped.startTime ??= message;
        break;
      case 'recipients':
        mapped.recipients ??= path === 'recipients' ? message : `${path}: ${message}`;
        break;
      default:
        break;
    }
  }

  return mapped;
}

export function ComposeForm() {
  const router = useRouter();
  const api = useApi();
  const { refetch: refetchStats } = useStatsContext();
  const { limits } = useSystemLimits();

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);

  const [uploadSummary, setUploadSummary] = useState<{
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    invalidSamples: string[];
  } | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  /**
   * Guards against a double submit at the source. `submitting` state alone is
   * not enough: two clicks dispatched in the same tick both read the old state
   * before React re-renders, and both would fire. A ref flips synchronously.
   */
  const inFlight = useRef(false);

  const validRecipients = useMemo(() => recipients.filter((r) => !r.invalid), [recipients]);
  const invalidRecipients = useMemo(() => recipients.filter((r) => r.invalid), [recipients]);

  const minDelayMs = limits?.config.minDelayBetweenEmailsMs ?? 2000;

  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};

    if (validRecipients.length === 0) {
      next.recipients = 'Add at least one recipient.';
    } else if (invalidRecipients.length > 0) {
      next.recipients = `Remove or fix ${invalidRecipients.length} invalid address${invalidRecipients.length === 1 ? '' : 'es'}.`;
    }

    if (subject.trim() === '') {
      next.subject = 'Subject is required.';
    }

    if (isHtmlEmpty(bodyHtml)) {
      next.bodyHtml = 'Write a message body before sending.';
    }

    // Empty delay means "no extra spacing", which is a legitimate 0. A typed
    // value has to be a non-negative number.
    if (delaySeconds.trim() !== '') {
      const parsed = Number(delaySeconds);
      if (!Number.isFinite(parsed) || parsed < 0) {
        next.delayBetweenMs = 'Delay must be 0 or more seconds.';
      }
    }

    const parsedLimit = Number(hourlyLimit);
    if (hourlyLimit.trim() === '' || !Number.isFinite(parsedLimit) || parsedLimit < 1) {
      next.hourlyLimit = 'Hourly limit must be at least 1.';
    }

    return next;
  }, [validRecipients, invalidRecipients, subject, bodyHtml, delaySeconds, hourlyLimit]);

  const handleSubmit = useCallback(async () => {
    if (inFlight.current) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error('Fix the highlighted fields before sending.');
      return;
    }

    inFlight.current = true;
    setSubmitting(true);

    const startTime = (scheduledAt ?? new Date(Date.now() + SEND_NOW_LEAD_MS)).toISOString();

    const payload: ScheduleCampaignInput = {
      subject: subject.trim(),
      // Sanitised at the boundary: this string is stored and later rendered
      // inside an email.
      bodyHtml: sanitizeHtml(bodyHtml),
      startTime,
      delayBetweenMs: delaySeconds.trim() === '' ? 0 : Math.round(Number(delaySeconds) * 1000),
      hourlyLimit: Number(hourlyLimit),
      // `name` is OMITTED when absent, never sent as null: recipientSchema in
      // backend/src/schemas/index.ts declares it `.optional()`, not
      // `.nullable()`, so an explicit null is a 400 on recipients.N.name.
      recipients: validRecipients.map((r) =>
        r.name?.trim() ? { email: r.email, name: r.name.trim() } : { email: r.email },
      ),
    };

    try {
      const result = await api.post<CreateCampaignResult>('/api/campaigns', payload);

      toast.success(`Scheduled ${result.enqueued} email${result.enqueued === 1 ? '' : 's'}`, {
        description:
          result.duplicatesDropped > 0
            ? `${result.duplicatesDropped} duplicate${result.duplicatesDropped === 1 ? '' : 's'} dropped.`
            : undefined,
      });

      // The sidebar badges live in AppShell, which survives this navigation —
      // without this they would still show the pre-send counts.
      refetchStats();

      // The list refetches on its own: EmailView remounts on navigation with
      // empty fetch state, so /scheduled cannot render a stale cache.
      router.push('/scheduled');
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped = mapBackendErrors(err.details);
        setErrors(mapped);
        toast.error(err.code === 'VALIDATION_ERROR' ? 'The API rejected this campaign' : 'Could not schedule', {
          description: err.message,
        });
      } else {
        toast.error('Could not schedule', { description: String(err) });
      }

      // Only released on failure. On success the route changes and this form
      // unmounts, so re-enabling would just re-arm a button nobody can see.
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [
    api,
    bodyHtml,
    delaySeconds,
    hourlyLimit,
    refetchStats,
    router,
    scheduledAt,
    subject,
    validate,
    validRecipients,
  ]);

  const senders = limits?.senders ?? [];
  const displaySender = senders[0]?.email ?? 'Loading senders…';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* ---------- header ---------- */}
      <div className="flex items-center gap-3 px-8 py-5">
        <button
          type="button"
          aria-label="Back to scheduled"
          data-testid="compose-back"
          onClick={() => router.push('/scheduled')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-surface-muted"
        >
          <ArrowLeft className="h-4.5 w-4.5" strokeWidth={1.75} />
        </button>

        <h1 className="text-[20px] text-foreground">Compose New Email</h1>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Attach a file"
            title="Attachments are not supported — the API takes recipients and an HTML body only."
            disabled
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted disabled:cursor-not-allowed"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </button>

          <div className="relative">
            <button
              type="button"
              aria-label="Send later"
              aria-expanded={popoverOpen}
              title="Schedule this campaign for later"
              data-testid="send-later-toggle"
              onClick={() => setPopoverOpen((v) => !v)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted',
                scheduledAt ? 'text-brand-green' : 'text-text-muted',
              )}
            >
              <Clock className="h-4 w-4" strokeWidth={1.75} />
            </button>

            {popoverOpen ? (
              <SendLaterPopover
                value={scheduledAt}
                onChange={setScheduledAt}
                onClose={() => setPopoverOpen(false)}
              />
            ) : null}
          </div>

          <Button
            variant="outline"
            size="sm"
            pill
            loading={submitting}
            onClick={() => void handleSubmit()}
            data-testid="send-button"
            title={
              scheduledAt
                ? `Scheduled for ${scheduledAt.toLocaleString()}`
                : 'Sends immediately — the first email goes out about 10 seconds from now.'
            }
            className="px-5"
          >
            {scheduledAt ? 'Send Later' : 'Send'}
          </Button>
        </div>
      </div>

      {/* ---------- form ---------- */}
      <div className="mx-auto w-full max-w-[820px] px-8 pb-10">
        <FieldRow label="From" divider={false}>
          {/*
            DISPLAY ONLY, and deliberately so. The backend assigns senders by
            round-robin across the active accounts and POST /api/campaigns has
            no senderId field at all (see scheduleCampaignSchema). Rendering a
            working-looking <select> that silently changed nothing would be
            worse than rendering this.
          */}
          <span
            data-testid="from-display"
            title={`Senders are assigned automatically, round-robin across active accounts (${senders.length} active).`}
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-[13px] text-foreground"
          >
            {displaySender}
            <ChevronDown className="h-3.5 w-3.5 text-text-muted" strokeWidth={2} />
          </span>
          <p className="pt-1 text-[11px] text-text-muted">
            Assigned automatically, round-robin across {senders.length || '…'} active account
            {senders.length === 1 ? '' : 's'}.
          </p>
        </FieldRow>

        <FieldRow
          label="To"
          htmlFor="recipient-input"
          error={errors.recipients}
          trailing={
            <UploadListButton
              onParsed={(result) => {
                setRecipients((current) => {
                  const seen = new Set(current.map((r) => r.email.toLowerCase()));
                  const added = result.recipients
                    .filter((r) => !seen.has(r.email.toLowerCase()))
                    .map((r) => ({ email: r.email, name: r.name ?? undefined }));
                  return [...current, ...added];
                });
                setUploadSummary({
                  total: result.total,
                  valid: result.valid,
                  invalid: result.invalid,
                  duplicates: result.duplicates,
                  invalidSamples: result.invalidSamples,
                });
                setErrors((e) => ({ ...e, recipients: undefined }));
              }}
            />
          }
          hint={
            uploadSummary ? (
              <span data-testid="upload-summary">
                <strong className="font-semibold text-foreground">
                  {uploadSummary.total} emails detected
                </strong>
                {' · '}
                <span
                  title={
                    uploadSummary.invalidSamples.length > 0
                      ? `Rejected: ${uploadSummary.invalidSamples.join(', ')}`
                      : 'No invalid addresses'
                  }
                  className={uploadSummary.invalid > 0 ? 'text-status-red-fg' : undefined}
                >
                  {uploadSummary.invalid} invalid
                </span>
                {' · '}
                {uploadSummary.duplicates} duplicate
                {uploadSummary.duplicates === 1 ? '' : 's'} removed
              </span>
            ) : null
          }
        >
          <RecipientInput
            inputId="recipient-input"
            value={recipients}
            onChange={(next) => {
              setRecipients(next);
              setErrors((e) => ({ ...e, recipients: undefined }));
            }}
            invalid={Boolean(errors.recipients)}
          />
        </FieldRow>

        <FieldRow label="Subject" htmlFor="subject-input" error={errors.subject}>
          <input
            id="subject-input"
            type="text"
            placeholder="Subject"
            data-testid="subject-input"
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
              setErrors((e) => ({ ...e, subject: undefined }));
            }}
            className={cn(
              'w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-muted',
              errors.subject && 'placeholder:text-status-red-fg/60',
            )}
          />
        </FieldRow>

        <FieldRow
          label="Delay between 2 emails"
          htmlFor="delay-input"
          error={errors.delayBetweenMs ?? errors.hourlyLimit}
          hint={
            <>
              Seconds between sends. The worker enforces a floor of{' '}
              {(minDelayMs / 1000).toFixed(0)}s regardless of what is set here.
            </>
          }
          className="[&>div]:gap-3"
        >
          <div className="flex items-center gap-4">
            <input
              id="delay-input"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="00"
              data-testid="delay-input"
              aria-label="Delay between 2 emails, in seconds"
              value={delaySeconds}
              onChange={(event) => {
                setDelaySeconds(event.target.value);
                setErrors((e) => ({ ...e, delayBetweenMs: undefined }));
              }}
              className={cn(
                'h-9 w-[74px] rounded-lg border bg-white px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-brand-green',
                errors.delayBetweenMs ? 'border-status-red-fg/60' : 'border-border-subtle',
              )}
            />
            <span className="text-[13px] text-text-secondary">sec</span>

            <label
              htmlFor="hourly-input"
              className="ml-2 text-[13px] font-medium text-foreground"
            >
              Hourly Limit
            </label>
            <input
              id="hourly-input"
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="00"
              data-testid="hourly-input"
              aria-label="Hourly limit"
              value={hourlyLimit}
              onChange={(event) => {
                setHourlyLimit(event.target.value);
                setErrors((e) => ({ ...e, hourlyLimit: undefined }));
              }}
              className={cn(
                'h-9 w-[74px] rounded-lg border bg-white px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-brand-green',
                errors.hourlyLimit ? 'border-status-red-fg/60' : 'border-border-subtle',
              )}
            />
          </div>
        </FieldRow>

        {/* ---------- body ---------- */}
        <div className="mt-5">
          <RichTextEditor
            onChange={(html) => {
              setBodyHtml(html);
              setErrors((e) => ({ ...e, bodyHtml: undefined }));
            }}
            invalid={Boolean(errors.bodyHtml)}
          />
          {errors.bodyHtml ? (
            <p role="alert" className="pt-1.5 text-[12px] text-status-red-fg">
              {errors.bodyHtml}
            </p>
          ) : null}
          {errors.startTime ? (
            <p role="alert" className="pt-1.5 text-[12px] text-status-red-fg">
              {errors.startTime}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
