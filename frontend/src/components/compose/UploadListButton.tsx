'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError, useApi } from '@/lib/api-client';
import { Spinner } from '@/components/ui/Spinner';
import type { UploadResult } from '@/types/api';

const ACCEPT = '.csv,.txt';

export interface UploadListButtonProps {
  onParsed: (result: UploadResult) => void;
}

/**
 * "Upload List" — posts a recipient file to POST /api/uploads/recipients and
 * hands the parsed result back.
 *
 * The endpoint is stateless: it returns the parsed recipients and persists
 * nothing, so the client holds the list and posts it back inside the campaign.
 * That means a failed upload costs nothing and can simply be retried.
 */
export function UploadListButton({ onParsed }: UploadListButtonProps) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const result = await api.upload<UploadResult>('/api/uploads/recipients', file);
      onParsed(result);

      toast.success(`${result.total} addresses detected`, {
        description: `${result.valid} valid · ${result.invalid} invalid · ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} removed`,
      });
    } catch (err) {
      // The 400s worth naming: wrong extension (fileFilter) and over 5MB
      // (multer limits). Both come back through the standard error envelope.
      const message =
        err instanceof ApiError
          ? err.message
          : 'Upload failed — check the file and try again.';

      toast.error('Could not parse that file', { description: message });
    } finally {
      setUploading(false);
      // Reset so re-picking the SAME file fires change again.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="upload-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <button
        type="button"
        disabled={uploading}
        data-testid="upload-list-button"
        onClick={() => inputRef.current?.click()}
        title="Upload a .csv or .txt list of recipients (max 5MB)"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-green transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-60"
      >
        {uploading ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : (
          <Upload className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {uploading ? 'Parsing…' : 'Upload List'}
      </button>
    </>
  );
}
