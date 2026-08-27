/**
 * ============================================================================
 * SERVER-SIDE HTML SANITISATION — the authoritative pass
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * `frontend/src/lib/sanitize-html.ts` scrubs the editor's contentEditable
 * output before it goes on the wire, and says so in its own header: anything a
 * client sanitises, a client can also skip. POST /api/campaigns is plain JSON
 * behind a bearer token — `curl` with a hand-written body never loads the
 * editor, never loads the browser sanitiser, and lands `<script>` straight in
 * `Campaign.bodyHtml`, from where it is copied into every `EmailJob.bodyHtml`
 * and posted into a mail client. So the real boundary is here, on the server,
 * where nothing can be bypassed.
 *
 * The browser pass is kept: it gives immediate feedback in the composer and
 * means the stored body matches what the user saw. This pass is the one that
 * is load-bearing.
 *
 * WHY THE POLICY IS DUPLICATED RATHER THAN IMPORTED
 * -------------------------------------------------
 * `backend/` and `frontend/` are separate npm packages with separate
 * tsconfigs and no workspace linking them, so neither can import from the
 * other without a build-tooling change that buys nothing at this size. The
 * ALLOWLISTS BELOW ARE THE SAME SETS as the frontend's, deliberately — if you
 * change one, change both, and treat THIS file as the definition. What differs
 * is only the mechanism, and it has to:
 *
 * WHY NOT THE SAME `<template>` TRICK
 * ------------------------------------
 * The browser version parses into a detached DOM, which is the right answer
 * when a DOM is free. Node has no DOM, and pulling in jsdom to sanitise a
 * string of marketing HTML is a heavy dependency for a small job. The other
 * tempting shortcut — regex-replacing `<script>` and `on\w+=` — is the one the
 * frontend header explicitly rejects, and it is right to: regexes lose to
 * nested quotes, unclosed tags and entity encoding, and a sanitiser that loses
 * is worse than no sanitiser because it produces false confidence.
 *
 * So this is a real (small) tokeniser: it walks the string once, understands
 * quoted attribute values, comments, doctypes, raw-text elements and
 * self-closing syntax, and rebuilds output from tokens it understood rather
 * than from patterns it deleted. Anything it cannot parse as a tag is emitted
 * as text, which is inert.
 *
 * THE MODEL: everything is denied unless named.
 *   - tag not in ALLOWED_TAGS      -> unwrapped (tag dropped, text kept)
 *   - tag in DROP_ENTIRELY         -> element AND its contents removed
 *   - attribute not named for that tag -> dropped
 *   - any `on*` attribute          -> dropped, in one rule, before anything else
 *   - href scheme not http/https/mailto -> dropped
 *   - style declaration not in ALLOWED_STYLE_PROPS -> dropped
 */

/** Elements the email body may keep. Everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'P', 'BR', 'DIV', 'SPAN',
  'UL', 'OL', 'LI',
  'BLOCKQUOTE',
  'H1', 'H2', 'H3', 'H4',
  'FONT',
]);

/** Elements removed outright, contents and all. */
const DROP_ENTIRELY = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH',
]);

/** Attributes that may survive, per tag. Everything else is dropped. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
  FONT: new Set(['size', 'color', 'face']),
  SPAN: new Set(['style']),
  DIV: new Set(['style']),
  P: new Set(['style']),
  LI: new Set(['style']),
};

/** Only these style declarations survive — no url(), no position, no content. */
const ALLOWED_STYLE_PROPS = new Set([
  'font-weight', 'font-style', 'text-decoration', 'text-align',
  'font-size', 'color', 'margin-left', 'padding-left',
]);

/**
 * Elements with no closing tag. They must never open a "skip until close"
 * region: treating `<meta>` as a container would swallow the entire rest of
 * the document, turning a sanitiser into a content-deleter.
 */
const VOID_ELEMENTS = new Set([
  'AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT',
  'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR',
]);

/**
 * Elements whose contents are NOT markup. Their bodies must be skipped by the
 * tokeniser itself, not walked as tags — `<script>if (a<b) {}</script>` would
 * otherwise be read as an element named `b`.
 */
const RAW_TEXT_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'TITLE']);

interface RawAttr {
  name: string;
  value: string;
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'start'; tag: string; attrs: RawAttr[]; selfClosing: boolean }
  | { kind: 'end'; tag: string };

/** The handful of named entities that matter for a scheme check, plus numerics. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  tab: '\t', newline: '\n', colon: ':', sol: '/', semi: ';',
  lpar: '(', rpar: ')', period: '.',
};

/**
 * Decode ONCE, never repeatedly.
 *
 * This is what makes `href="java&#115;cript:alert(1)"` fail the scheme check
 * instead of sailing through it: the browser decodes entities before resolving
 * a URL, so a check run against the raw attribute text is checking a string
 * the browser will never see. Decoding once (not to a fixed point) matches
 * browser behaviour — `&amp;#106;` really is the literal text `&#106;`, and
 * decoding it twice would invent an attack that does not exist.
 */
function decodeEntities(input: string): string {
  return input.replace(
    /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g,
    (full, body: string) => {
      if (body.startsWith('#')) {
        const isHex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
          return full;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? full;
    },
  );
}

/** Re-encode on the way out, so a decoded value can never re-open a tag. */
function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const isWhitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

/**
 * One pass over the string, producing tokens.
 *
 * Sticky regex + index arithmetic rather than repeated `slice()`: a 100_000
 * character body with a few thousand tags would otherwise copy the tail of the
 * string once per tag.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const tagName = /\/?([a-zA-Z][a-zA-Z0-9-]*)/y;
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);

    if (lt === -1) {
      tokens.push({ kind: 'text', value: html.slice(i) });
      break;
    }
    if (lt > i) {
      tokens.push({ kind: 'text', value: html.slice(i, lt) });
    }

    // <!-- comment --> : dropped, including a conditional comment's payload.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    // <!doctype ...>, <![CDATA[...]]>, <?xml ...?> : dropped.
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    tagName.lastIndex = lt + 1;
    const match = tagName.exec(html);

    if (!match) {
      // A bare '<' that starts no tag. Emit it as text — it is inert, and
      // deleting it would silently eat the user's "a < b".
      tokens.push({ kind: 'text', value: '<' });
      i = lt + 1;
      continue;
    }

    const isEnd = match[0].startsWith('/');
    const tag = match[1]!.toUpperCase();
    let j = tagName.lastIndex;

    const attrs: RawAttr[] = [];
    let selfClosing = false;

    // ---- attribute scan, quote-aware ------------------------------------
    while (j < html.length) {
      while (j < html.length && isWhitespace(html[j]!)) {
        j += 1;
      }
      if (j >= html.length) {
        break;
      }
      if (html[j] === '>') {
        j += 1;
        break;
      }
      if (html[j] === '/' && html[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      if (html[j] === '/') {
        j += 1;
        continue;
      }

      const nameStart = j;
      while (
        j < html.length &&
        !isWhitespace(html[j]!) &&
        html[j] !== '=' &&
        html[j] !== '>' &&
        html[j] !== '/'
      ) {
        j += 1;
      }
      const name = html.slice(nameStart, j);
      if (!name) {
        j += 1;
        continue;
      }

      let k = j;
      while (k < html.length && isWhitespace(html[k]!)) {
        k += 1;
      }

      let value = '';
      if (html[k] === '=') {
        k += 1;
        while (k < html.length && isWhitespace(html[k]!)) {
          k += 1;
        }
        const quote = html[k];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, k + 1);
          if (end === -1) {
            value = html.slice(k + 1);
            k = html.length;
          } else {
            value = html.slice(k + 1, end);
            k = end + 1;
          }
        } else {
          const valueStart = k;
          while (k < html.length && !isWhitespace(html[k]!) && html[k] !== '>') {
            k += 1;
          }
          value = html.slice(valueStart, k);
        }
        j = k;
      }

      attrs.push({ name, value });
    }

    i = j;

    if (isEnd) {
      tokens.push({ kind: 'end', tag });
      continue;
    }

    tokens.push({ kind: 'start', tag, attrs, selfClosing });

    // Raw-text element: its body is text, not markup. Skip to the close tag so
    // the tokeniser never tries to read `if (a<b)` as an element.
    if (RAW_TEXT_ELEMENTS.has(tag) && !selfClosing && !VOID_ELEMENTS.has(tag)) {
      const closeRe = new RegExp(`</${tag}[\\s>]`, 'i');
      const rest = html.slice(i);
      const found = rest.search(closeRe);
      if (found === -1) {
        // Unclosed <script> — everything after it is script body. Drop it all.
        i = html.length;
      } else {
        const closeStart = i + found;
        const gt = html.indexOf('>', closeStart);
        i = gt === -1 ? html.length : gt + 1;
        tokens.push({ kind: 'end', tag });
      }
    }
  }

  return tokens;
}

function sanitizeStyle(value: string): string {
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const [prop, val] = decl.split(':').map((s) => s?.trim().toLowerCase() ?? '');
      if (!prop || !val) return false;
      if (!ALLOWED_STYLE_PROPS.has(prop)) return false;
      // url() can fetch a tracking pixel or worse; expression() is legacy IE
      // script execution. Neither has any business in a formatting style.
      return !val.includes('url(') && !val.includes('expression(');
    })
    .join('; ');
}

function isSafeHref(raw: string): boolean {
  // Decode first, then strip the characters a browser ignores inside a URL —
  // `java\tscript:` and `java&#10;script:` both resolve to `javascript:`.
  const value = decodeEntities(raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020]/g, '')
    .toLowerCase();

  // Relative and anchor links are fine. Of the schemes, only these three.
  if (!/^[a-z][a-z0-9+.-]*:/.test(value)) return true;
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('mailto:');
}

/** Rebuild one start tag from only the attributes that survived the policy. */
function renderStartTag(tag: string, attrs: RawAttr[]): string {
  const lower = tag.toLowerCase();
  const kept: string[] = [];
  let hasHref = false;

  for (const attr of attrs) {
    const name = attr.name.toLowerCase();

    // Every inline event handler, in one rule, checked before the allowlist so
    // no per-tag entry can ever accidentally re-admit one.
    if (name.startsWith('on')) {
      continue;
    }
    if (!ALLOWED_ATTRS[tag]?.has(name)) {
      continue;
    }

    if (name === 'href') {
      if (!isSafeHref(attr.value)) {
        continue;
      }
      hasHref = true;
      kept.push(`href="${escapeAttrValue(decodeEntities(attr.value))}"`);
      continue;
    }

    if (name === 'style') {
      const safe = sanitizeStyle(decodeEntities(attr.value));
      if (safe) {
        kept.push(`style="${escapeAttrValue(safe)}"`);
      }
      continue;
    }

    kept.push(`${name}="${escapeAttrValue(decodeEntities(attr.value))}"`);
  }

  // Anything leaving in a link should not hand the opener window away.
  if (tag === 'A' && hasHref) {
    kept.push('rel="noopener noreferrer"');
  }

  if (VOID_ELEMENTS.has(tag)) {
    return kept.length > 0 ? `<${lower} ${kept.join(' ')} />` : `<${lower} />`;
  }
  return kept.length > 0 ? `<${lower} ${kept.join(' ')}>` : `<${lower}>`;
}

/**
 * Scrub a campaign body. Safe to run on already-sanitised markup — it is
 * idempotent, which matters because the frontend has usually run its own pass
 * first and the two must not fight.
 */
export function sanitizeHtml(html: string): string {
  const tokens = tokenize(html);
  const out: string[] = [];

  /** Open elements. `emitted: false` means the tag was unwrapped. */
  const stack: { tag: string; emitted: boolean }[] = [];

  /** While set, we are inside a DROP_ENTIRELY element and everything goes. */
  let dropTag: string | null = null;
  let dropDepth = 0;

  for (const token of tokens) {
    if (dropTag) {
      if (token.kind === 'start' && token.tag === dropTag && !token.selfClosing) {
        dropDepth += 1;
      } else if (token.kind === 'end' && token.tag === dropTag) {
        dropDepth -= 1;
        if (dropDepth === 0) {
          dropTag = null;
        }
      }
      continue;
    }

    if (token.kind === 'text') {
      out.push(token.value);
      continue;
    }

    if (token.kind === 'start') {
      const { tag, attrs, selfClosing } = token;
      const isVoid = VOID_ELEMENTS.has(tag) || selfClosing;

      if (DROP_ENTIRELY.has(tag)) {
        // A void drop-tag (<meta>, <link>, <input>) has no contents to skip;
        // opening a drop region for it would eat the rest of the document.
        if (!isVoid) {
          dropTag = tag;
          dropDepth = 1;
        }
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap rather than delete: an unknown wrapper should lose its tag,
        // not take the user's text with it.
        if (!isVoid) {
          stack.push({ tag, emitted: false });
        }
        continue;
      }

      out.push(renderStartTag(tag, attrs));
      if (!isVoid) {
        stack.push({ tag, emitted: true });
      }
      continue;
    }

    // ---- end tag ---------------------------------------------------------
    // Close through to the matching open element, so an unclosed <div> inside
    // a <p> cannot leak an unbalanced tag into the output.
    const at = stack.map((e) => e.tag).lastIndexOf(token.tag);
    if (at === -1) {
      continue; // stray close tag — nothing to close
    }
    while (stack.length > at) {
      const entry = stack.pop()!;
      if (entry.emitted) {
        out.push(`</${entry.tag.toLowerCase()}>`);
      }
    }
  }

  // Anything still open at EOF gets closed, in order.
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (entry.emitted) {
      out.push(`</${entry.tag.toLowerCase()}>`);
    }
  }

  return out.join('').trim();
}

/** True when the markup carries no actual text and no <br>. */
export function isHtmlEmpty(html: string): boolean {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

  return text.length === 0;
}
