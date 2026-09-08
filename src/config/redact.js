import { stripJsonc } from './parse.js';

const REDACTED = '[REDACTED]';

// Key names whose VALUES must never be displayed. Unanchored on purpose:
// over-redacting a flag like `apiKeyRequired` is harmless, leaking a key is
// not. Booleans and numbers under these keys are still shown (a flag is not a
// secret); only strings and containers are redacted.
export const SENSITIVE_KEY = /(?:^key$|^token$|^access$|^refresh$|api[_-]?key|access[_-]?token|refresh[_-]?token|(?:id|session)[_-]?token|auth(?:orization)?|oauth|bearer|secret|password|passwd|credential|cookie|private[_-]?key|client[_-]?secret|user[_-]?id|machine[_-]?id)/i;

// Containers whose whole content is sensitive regardless of inner key names
// (HTTP headers, oauth blocks, credential stores). `env` is deliberately NOT
// here: env var names describe their own sensitivity (ANTHROPIC_API_KEY vs
// ANTHROPIC_MODEL), so env is walked into and redacted per key — that is what
// keeps Claude's third-party endpoint/model settings readable.
const SENSITIVE_CONTAINER = /^(?:headers?|custom[_-]?headers?|oauth|credentials?|secrets?)$/i;

// ---------------------------------------------------------------------------
// Redaction

export function redactString(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|xox[baprs]|gh[pousr])[-_][A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/(https?:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function redactedTree(value) {
  if (Array.isArray(value)) return value.map((entry) => redactedTree(entry));
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_CONTAINER.test(key)) {
      out[key] = REDACTED;
    } else if (SENSITIVE_KEY.test(key) && (typeof entry === 'string' || (entry && typeof entry === 'object'))) {
      out[key] = REDACTED;
    } else {
      out[key] = redactedTree(entry);
    }
  }
  return out;
}

// Scan one line of a value: count brackets that sit outside quoted spans
// and comments, and report the multi-line string delimiter (`"""`/`'''`)
// the line ends inside, if any. `triple` is the delimiter the line starts
// inside (null when it does not). Single-quote state never crosses a line —
// an unterminated one-line string means a malformed file, and the next line
// is a fresh statement.
function scanValueLine(line, triple) {
  let depth = 0;
  let quote = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (triple) {
      if (ch === '\\') { i += 2; continue; }
      if (line.startsWith(triple, i)) { triple = null; i += 3; continue; }
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const delim = ch.repeat(3);
      if (line.startsWith(delim, i)) { triple = delim; i += 3; continue; }
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '#') break; // TOML comment
    if (ch === '/' && line[i + 1] === '/') break; // JSONC comment
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    i += 1;
  }
  return { depth, triple };
}

function redactLines(content) {
  let sensitiveSection = false;
  // Active while a sensitive value spans lines. `triple` is the open
  // multi-line string delimiter — every content line is dropped whole,
  // because it is pure secret. `depth` is the count of still-open brackets
  // — lines are redacted in place until they close, quote-aware so a `]`
  // inside a string does not end the value early. A value that never closes
  // (a preview cut at PREVIEW_BYTES, or a malformed file) suppresses to the
  // end of the preview.
  let suppress = null;

  return content
    .split(/\r?\n/)
    .flatMap((line) => {
      if (suppress) {
        const startedInString = Boolean(suppress.triple);
        const scan = scanValueLine(line, suppress.triple);
        suppress.triple = scan.triple;
        suppress.depth += scan.depth;
        if (startedInString) {
          // String content, or the closing line (which may trail more
          // secret) — drop it whole.
          if (!scan.triple && suppress.depth <= 0) suppress = null;
          return [];
        }
        if (!scan.triple && suppress.depth <= 0) suppress = null;
        const assignment = line.replace(/^\s*(["']?[^"'=:\s]+["']?\s*[:=]\s*).*(,?)\s*$/, `$1"${REDACTED}"$2`);
        if (assignment !== line) return [assignment];
        if (/^\s*[}\]]\s*,?\s*$/.test(line) || /^\s*(?:\/\/|#|$)/.test(line)) return [line];
        return [`${line.match(/^\s*/)?.[0] || ''}"${REDACTED}"${line.trimEnd().endsWith(',') ? ',' : ''}`];
      }

      const section = line.match(/^\s*\[+([^\]]+)]+/);
      if (section) {
        sensitiveSection = section[1]
          .split('.')
          .some((part) => SENSITIVE_KEY.test(part) || SENSITIVE_CONTAINER.test(part.replace(/^['"]|['"]$/g, '')));
        return [line];
      }

      // The optional leading `{`/`[` lets a first JSON key on the same line
      // as its opening brace (`{"apiKey": …` in a malformed file) be seen.
      const keyMatch = line.match(/^\s*[{\[]?\s*["']?([^"'=:\s]+)["']?\s*[:=]/);
      const key = keyMatch?.[1] || '';

      if (keyMatch && (sensitiveSection || SENSITIVE_KEY.test(key) || SENSITIVE_CONTAINER.test(key))) {
        // A value that stays open past this line (a multi-line string, or
        // brackets that do not close) must suppress its continuation lines;
        // a balanced value is rewritten in place either way.
        const scan = scanValueLine(line.slice(keyMatch[0].length), null);
        if (scan.triple || scan.depth > 0) {
          suppress = { depth: scan.depth, triple: scan.triple };
        }
        return [line.replace(/([:=]\s*).*(,?)\s*$/, `$1"${REDACTED}"$2`)];
      }

      if (!keyMatch && sensitiveSection) {
        // A bare line inside a sensitive section: closers, comments and
        // blanks pass; anything else is value content of a malformed
        // statement and is redacted.
        if (/^\s*[}\]]\s*,?\s*$/.test(line) || /^\s*(?:\/\/|#|$)/.test(line)) return [line];
        return [`${line.match(/^\s*/)?.[0] || ''}"${REDACTED}"${line.trimEnd().endsWith(',') ? ',' : ''}`];
      }

      // Catch common bearer/key literals even when a format uses an unusual
      // key shape. Previews are for orientation; this errs on the safe side.
      return [redactString(line)];
    })
    .join('\n');
}

export function redactConfig(content, format = 'text') {
  if (format === 'json' || format === 'jsonc') {
    try {
      return JSON.stringify(redactedTree(JSON.parse(format === 'jsonc' ? stripJsonc(content) : content)), null, 2);
    } catch {
      // A malformed or mid-write file still gets a safe line-based preview.
    }
  }
  return redactLines(content);
}

