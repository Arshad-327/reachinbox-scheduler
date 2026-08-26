'use client';

import { cn } from '@/lib/cn';
import { formatFullTimestamp, formatScheduleTime } from '@/lib/format';
import type { EmailJobDTO } from '@/types/api';
import { Badge } from '@/components/ui/Badge';
import { ExternalLinkIcon, StarIcon } from '@/components/ui/icons';

export type EmailRowVariant = 'scheduled' | 'sent';

export interface EmailListRowProps {
  job: EmailJobDTO;
  variant: EmailRowVariant;
}

/**
 * One row of the list.
 *
 * Not a table: the Figma is a flow of rows separated by hairlines, and a real
 * <table> would fight the truncation behaviour the subject/preview needs.
 * The "To:" column is a fixed 180px so the status pills line up down the page
 * regardless of name length — that alignment is the thing that makes the list
 * read as columns without being one.
 *
 * A sent row with a previewUrl becomes a link to the Ethereal preview. That is
 * how a send is demonstrated to have really happened, so it is worth the extra
 * branch here rather than a separate component.
 */
export function EmailListRow({ job, variant }: EmailListRowProps) {
  // Already plain text and already truncated by the API.
  const preview = job.bodyPreview?.trim() || null;
  const isFailed = job.status === 'FAILED';
  const href = variant === 'sent' && job.previewUrl ? job.previewUrl : null;

  // The recipient's display name, falling back to the address. The Figma shows
  // "To: John Smith"; a list uploaded without names still has to render.
  const recipient = job.recipientName?.trim() || job.recipientEmail;

  const content = (
    <>
      <span className="w-[180px] shrink-0 truncate text-[13px] font-semibold text-foreground">
        To: {recipient}
      </span>

      {variant === 'scheduled' ? (
        <Badge status={job.status} title={new Date(job.scheduledAt).toString()}>
          {formatScheduleTime(job.scheduledAt)}
        </Badge>
      ) : (
        <Badge
          status={job.status}
          title={
            isFailed
              ? (job.lastError ?? 'Failed')
              : `Sent ${formatFullTimestamp(job.sentAt)}`
          }
        />
      )}

      {/* min-w-0 is what actually makes the truncation work inside a flex row. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-snug">
          <span className="font-semibold text-foreground">{job.subject}</span>
          {preview ? (
            <>
              <span className="text-text-muted"> - </span>
              <span className="text-text-secondary">{preview}</span>
            </>
          ) : null}
        </span>

        {isFailed && job.lastError ? (
          <span className="mt-1 block truncate text-[11px] leading-snug text-status-red-fg">
            {job.lastError}
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2 text-text-muted">
        {href ? (
          // Hidden until hover: the Figma has no link glyph, but a clickable
          // row needs to announce itself somehow.
          <ExternalLinkIcon className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
        <StarIcon className="h-4 w-4 transition-colors hover:text-status-amber-fg" />
      </span>
    </>
  );

  const rowClass = cn(
    'group flex w-full items-center gap-4 border-b border-border-hairline px-6 py-3.5 text-left',
    'transition-colors hover:bg-surface-muted/60',
    href && 'cursor-pointer',
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        // noopener is the one that matters (it severs window.opener); noreferrer
        // is here because there is no reason to leak the dashboard URL to
        // Ethereal.
        rel="noopener noreferrer"
        data-testid="email-row"
        data-preview-url={href}
        title="Open the delivered message on Ethereal"
        className={rowClass}
      >
        {content}
      </a>
    );
  }

  return (
    <div data-testid="email-row" className={rowClass}>
      {content}
    </div>
  );
}
