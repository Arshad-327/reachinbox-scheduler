/**
 * Strips the dangerous parts out of contentEditable output before it is sent.
 *
 * WHY THIS EXISTS: the editor's innerHTML is stored by the backend and later
 * rendered inside an email. A paste from a web page can carry <script>, inline
 * event handlers, javascript: URLs and <iframe>s straight through, and "it is
 * only my own typing" stops being true the moment someone pastes.
 *
 * WHAT THIS IS NOT: a general-purpose sanitiser for untrusted input. It runs in
 * the browser, on our own editor's markup, as a last line of defence before the
 * wire. A production build would run DOMPurify here AND sanitise again
 * server-side, because anything a client sanitises a client can also skip — the
 * request is just JSON, and nothing stops it being posted by hand.
 *
 * Implemented against a detached DOM rather than regexes: parsing HTML with
 * regular expressions loses to nested quotes, malformed tags and entity
 * encoding, and a sanitiser that loses is worse than none.
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
  const value = raw.trim().toLowerCase();
  // Relative and anchor links are fine. Of the schemes, only these three.
  if (!/^[a-z][a-z0-9+.-]*:/.test(value)) return true;
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('mailto:');
}

function scrub(node: Element): void {
  // Iterate over a snapshot: the loop removes and unwraps children, and a live
  // HTMLCollection would shift underneath it.
  for (const child of Array.from(node.children)) {
    scrub(child);
  }

  const tag = node.tagName.toUpperCase();

  if (DROP_ENTIRELY.has(tag)) {
    node.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap rather than delete: an unknown wrapper should lose its tag, not
    // take the user's text with it.
    node.replaceWith(...Array.from(node.childNodes));
    return;
  }

  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();

    // Every inline event handler, in one rule.
    if (name.startsWith('on')) {
      node.removeAttribute(attr.name);
      continue;
    }

    if (!ALLOWED_ATTRS[tag]?.has(name)) {
      node.removeAttribute(attr.name);
      continue;
    }

    if (name === 'href' && !isSafeHref(attr.value)) {
      node.removeAttribute(attr.name);
      continue;
    }

    if (name === 'style') {
      const safe = sanitizeStyle(attr.value);
      if (safe) {
        node.setAttribute('style', safe);
      } else {
        node.removeAttribute('style');
      }
    }
  }

  // Anything leaving in a link should not hand the opener window away.
  if (tag === 'A' && node.hasAttribute('href')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
}

export function sanitizeHtml(html: string): string {
  // A detached template never executes what it parses: scripts inside a
  // <template> are inert, and no <img onerror> fires because nothing loads.
  const template = document.createElement('template');
  template.innerHTML = html;

  for (const child of Array.from(template.content.children)) {
    scrub(child);
  }

  return template.innerHTML.trim();
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
