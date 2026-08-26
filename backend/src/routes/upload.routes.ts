import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';

import { requireAuth } from '../middleware/auth.js';
import { BadRequestError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('upload');

export const uploadRouter = Router();

uploadRouter.use(requireAuth);

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.csv', '.txt'];

/**
 * memoryStorage, never disk: the parsed result is returned to the caller and
 * the buffer is discarded. Nothing about the upload is persisted — see the
 * note on the handler below.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      cb(new BadRequestError(`Only ${ALLOWED_EXTENSIONS.join(' and ')} files are accepted`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Deliberately permissive but not naive: one @, no whitespace, a dotted TLD of
 * at least two characters. Full RFC 5322 is famously unmatchable by regex and
 * rejecting odd-but-valid addresses is worse here than accepting a few that
 * will simply bounce.
 */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

const EMAIL_HEADERS = ['email', 'e-mail', 'email_address', 'emailaddress', 'mail'];
const NAME_HEADERS = ['name', 'first_name', 'firstname', 'full_name', 'fullname'];

export interface ParsedRecipient {
  email: string;
  name?: string;
}

interface ParseOutcome {
  mode: 'csv-with-header' | 'bare-list';
  candidates: ParsedRecipient[];
}

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_');

/**
 * Works out whether the payload is a header-ed CSV or a bare list, then
 * extracts candidates. Detection is by content, not by file extension: a .csv
 * holding a bare newline-separated list is common, and so is a .txt with a
 * proper header row.
 */
function extractCandidates(raw: string): ParseOutcome {
  const text = raw.replace(/^﻿/, '').trim();

  const probe = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 1 });
  const firstRow = (probe.data[0] ?? []).map((c) => String(c));
  const headerish = firstRow.map(normaliseHeader);
  const hasHeader = headerish.some((h) => EMAIL_HEADERS.includes(h));

  if (hasHeader) {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normaliseHeader,
    });

    const fields = (parsed.meta.fields ?? []).map(normaliseHeader);
    const emailKey = fields.find((f) => EMAIL_HEADERS.includes(f))!;
    const nameKey = fields.find((f) => NAME_HEADERS.includes(f));

    const candidates = parsed.data.map((row) => {
      const email = (row[emailKey] ?? '').trim();
      const name = nameKey ? (row[nameKey] ?? '').trim() : '';
      return name ? { email, name } : { email };
    });

    return { mode: 'csv-with-header', candidates };
  }

  // No recognisable header: treat the whole payload as addresses separated by
  // newlines, commas, semicolons or tabs.
  const candidates = text
    .split(/[\r\n,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((email) => ({ email }));

  return { mode: 'bare-list', candidates };
}

/**
 * Parses a recipient list and returns it to the caller.
 *
 * NOTHING IS PERSISTED. The upload is stateless by design: the frontend holds
 * the parsed list and posts it back inside the campaign payload. That keeps
 * this endpoint idempotent and side-effect free (an abandoned upload leaves no
 * orphaned rows or files to clean up), avoids a second source of truth for
 * "recipients that exist but belong to no campaign", and means a user can
 * re-parse and edit freely before committing. The cost is that a very large
 * list crosses the wire twice — acceptable at the 5000-recipient ceiling, and
 * the point at which it stops being acceptable is the same point at which the
 * whole flow should move to streamed server-side ingestion.
 */
uploadRouter.post('/recipients', upload.single('file'), async (req, res) => {
  if (!req.file) {
    throw new BadRequestError('No file uploaded — send one file under the "file" field');
  }

  const { mode, candidates } = extractCandidates(req.file.buffer.toString('utf8'));

  const seen = new Set<string>();
  const recipients: ParsedRecipient[] = [];
  const invalidSamples: string[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const candidate of candidates) {
    const email = candidate.email.trim();

    if (!EMAIL_RE.test(email)) {
      invalid += 1;
      if (invalidSamples.length < 5) {
        invalidSamples.push(email);
      }
      continue;
    }

    const key = email.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }

    seen.add(key);
    recipients.push(candidate.name ? { email, name: candidate.name } : { email });
  }

  log.info(
    {
      filename: req.file.originalname,
      bytes: req.file.size,
      mode,
      total: candidates.length,
      valid: recipients.length,
      invalid,
      duplicates,
    },
    'parsed recipient upload',
  );

  res.json({
    mode,
    total: candidates.length,
    valid: recipients.length,
    invalid,
    duplicates,
    invalidSamples,
    recipients,
  });
});
