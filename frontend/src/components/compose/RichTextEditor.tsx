'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  Bold,
  ChevronsUpDown,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * The body editor.
 *
 * DELIBERATELY NOT A RICH TEXT LIBRARY. This is a contentEditable div driven by
 * document.execCommand. That API is formally deprecated and its exact output
 * varies between engines (Chrome emits <b>, Firefox may emit <span
 * style="font-weight:bold">, and neither is guaranteed stable) — but every
 * browser still implements it, the output is normalised by sanitizeHtml()
 * before it goes anywhere, and the alternative is shipping ~100KB of TipTap or
 * Lexical to get bold, italic and a bullet list.
 *
 * A production build would use TipTap or Lexical: a real schema, predictable
 * serialisation, collaborative editing, and no dependence on an API browsers
 * have promised to remove. At this scope that trade would be all cost.
 *
 * The editor is UNCONTROLLED. Writing innerHTML back on every render would
 * destroy the caret on every keystroke, so React owns the initial value and
 * nothing else; the current markup is read out via onChange.
 */

interface ToolbarAction {
  icon: typeof Bold;
  label: string;
  command: string;
  value?: string;
  /** Renders a divider before this button. */
  startsGroup?: boolean;
}

const ACTIONS: ToolbarAction[] = [
  { icon: Undo2, label: 'Undo', command: 'undo' },
  { icon: Redo2, label: 'Redo', command: 'redo' },

  { icon: Type, label: 'Larger text', command: 'fontSize', value: '5', startsGroup: true },
  { icon: ChevronsUpDown, label: 'Smaller text', command: 'fontSize', value: '2' },

  { icon: Bold, label: 'Bold', command: 'bold', startsGroup: true },
  { icon: Italic, label: 'Italic', command: 'italic' },
  { icon: Underline, label: 'Underline', command: 'underline' },

  { icon: AlignLeft, label: 'Align left', command: 'justifyLeft', startsGroup: true },

  { icon: ListOrdered, label: 'Numbered list', command: 'insertOrderedList', startsGroup: true },
  { icon: List, label: 'Bullet list', command: 'insertUnorderedList' },
  { icon: Indent, label: 'Indent', command: 'indent' },
  { icon: Outdent, label: 'Outdent', command: 'outdent' },

  { icon: Quote, label: 'Quote', command: 'formatBlock', value: 'blockquote', startsGroup: true },
  { icon: Strikethrough, label: 'Strikethrough', command: 'strikeThrough' },
];

export interface RichTextEditorProps {
  /** Initial markup. Changes after mount are ignored — see the note above. */
  initialHtml?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  invalid?: boolean;
}

export function RichTextEditor({
  initialHtml = '',
  onChange,
  placeholder = 'Type Your Reply...',
  invalid = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(!initialHtml);

  useEffect(() => {
    const el = editorRef.current;
    if (el && initialHtml && el.innerHTML === '') {
      el.innerHTML = initialHtml;
      setIsEmpty(false);
    }
    // Mount only, on purpose: re-running this would stomp the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    setIsEmpty(el.textContent?.trim() === '' && !el.querySelector('img, br, li'));
    onChange(el.innerHTML);
  }

  function run(action: ToolbarAction) {
    // The selection has to be inside the editable region or execCommand either
    // no-ops or, worse, formats whatever else is selected on the page.
    editorRef.current?.focus();
    document.execCommand(action.command, false, action.value);
    emit();
  }

  return (
    <div
      className={cn(
        'rounded-xl bg-surface-muted p-4',
        invalid && 'ring-1 ring-status-red-fg/40',
      )}
    >
      <div className="relative">
        {isEmpty ? (
          <span className="pointer-events-none absolute left-0 top-0 text-[13px] text-text-muted">
            {placeholder}
          </span>
        ) : null}

        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          data-testid="body-editor"
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          className="min-h-[200px] text-[13px] leading-relaxed text-foreground outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-border-subtle [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
        />
      </div>

      {/* White bar floating on the grey surface, as in the Figma. */}
      <div className="mt-3 flex flex-wrap items-center gap-0.5 rounded-lg bg-white px-2 py-1.5">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <span key={action.label} className="flex items-center">
              {action.startsGroup ? (
                <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-border-subtle" />
              ) : null}
              <button
                type="button"
                title={action.label}
                aria-label={action.label}
                data-command={action.command}
                data-testid={`toolbar-${action.command}${action.value ? `-${action.value}` : ''}`}
                // onMouseDown, not onClick: a click would move focus out of the
                // editor first and collapse the selection execCommand needs.
                onMouseDown={(event) => {
                  event.preventDefault();
                  run(action);
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
