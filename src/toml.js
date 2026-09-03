// Tolerant TOML subset reader for agent configuration files (Codex, Kimi Code).
//
// Covers what real agent configs actually use: comments, table headers with
// bare/quoted/dotted keys (`[providers."managed:kimi-code".oauth]`,
// `[projects.'c:\repo']`), key = value pairs with basic and literal strings
// (single- and multi-line), integers, floats, booleans, arrays (multi-line,
// trailing commas) and inline tables. Anything else (dates, bare tokens)
// degrades to plain strings. The parser never throws: parseToml returns
// { value, error } and keeps everything parsed before the first problem, so a
// partially-written config still renders.

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;
const VALUE_STOP_CHARS = ' \t\r\n,]}#';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unescapeBasic(body) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\' || i + 1 >= body.length) {
      out += body[i];
      continue;
    }
    const esc = body[i + 1];
    i += 1;
    out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc === 'b' ? '\b' : esc === 'f' ? '\f' : esc;
  }
  return out;
}

function coerceScalar(token) {
  if (/^[+-]?[0-9][0-9_]*$/.test(token)) return Number(token.replaceAll('_', ''));
  if (/^[+-]?[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?$/.test(token) && /[.eE]/.test(token)) {
    return Number(token.replaceAll('_', ''));
  }
  return token;
}

export function parseToml(text) {
  const src = String(text ?? '');
  const root = {};
  let table = root;
  let error = null;
  let pos = 0;

  const fail = (message) => {
    if (error === null) error = `${message} (offset ${pos})`;
  };

  const skipInline = () => {
    while (pos < src.length && ' \t\r'.includes(src[pos])) pos += 1;
  };
  const skipComment = () => {
    if (src[pos] === '#') {
      while (pos < src.length && src[pos] !== '\n') pos += 1;
    }
  };
  const skipToNextLine = () => {
    while (pos < src.length && src[pos] !== '\n') pos += 1;
    if (pos < src.length) pos += 1;
  };
  const skipBlanks = () => {
    for (;;) {
      skipInline();
      skipComment();
      if (src[pos] === '\n') {
        pos += 1;
        continue;
      }
      return;
    }
  };

  // Reads a quoted string; `pos` must sit on the opening quote.
  const readString = () => {
    const quote = src[pos];
    const triple = quote.repeat(3);
    if (src.startsWith(triple, pos)) {
      const end = src.indexOf(triple, pos + 3);
      if (end < 0) {
        fail('unterminated multi-line string');
        pos = src.length;
        return '';
      }
      let body = src.slice(pos + 3, end);
      if (body.startsWith('\r\n')) body = body.slice(2);
      else if (body[0] === '\n') body = body.slice(1);
      pos = end + 3;
      return quote === '"' ? unescapeBasic(body) : body;
    }
    const end = src.indexOf(quote, pos + 1);
    if (end < 0) {
      fail('unterminated string');
      pos = src.length;
      return '';
    }
    const body = src.slice(pos + 1, end);
    pos = end + 1;
    return quote === '"' ? unescapeBasic(body) : body;
  };

  const readKeyPart = () => {
    if (src[pos] === '"' || src[pos] === "'") return readString();
    const start = pos;
    while (pos < src.length && BARE_KEY_CHAR.test(src[pos])) pos += 1;
    return pos === start ? null : src.slice(start, pos);
  };

  const readKeyPath = () => {
    const parts = [];
    for (;;) {
      skipInline();
      const part = readKeyPart();
      if (part === null || part === '') return null;
      parts.push(part);
      skipInline();
      if (src[pos] === '.') {
        pos += 1;
        continue;
      }
      return parts;
    }
  };

  const readArray = () => {
    const out = [];
    for (;;) {
      skipBlanks();
      if (pos >= src.length) {
        fail('unterminated array');
        return { value: out };
      }
      if (src[pos] === ']') {
        pos += 1;
        return { value: out };
      }
      const item = readValue();
      if (item.bad) {
        fail('invalid array element');
        skipToNextLine();
        continue;
      }
      out.push(item.value);
      skipBlanks();
      if (src[pos] === ',') {
        pos += 1;
        continue;
      }
      if (src[pos] === ']' || pos >= src.length) {
        if (src[pos] === ']') pos += 1;
        else fail('unterminated array');
        return { value: out };
      }
      // Unexpected token where , or ] belongs (a truncated array). Rewind to
      // just before the junk and return, so the caller can resync on the next
      // key = value line instead of swallowing the rest of the file.
      pos = item.start;
      fail('expected , or ] in array');
      return { value: out, resync: true };
    }
  };

  const readInlineTable = () => {
    const out = {};
    for (;;) {
      skipInline();
      if (src[pos] === '}') {
        pos += 1;
        return { value: out };
      }
      const parts = readKeyPath();
      skipInline();
      if (parts === null || src[pos] !== '=') {
        fail('malformed inline table');
        skipToNextLine();
        return { value: out };
      }
      pos += 1;
      const val = readValue();
      if (val.bad) {
        fail('invalid inline table value');
        skipToNextLine();
        return { value: out };
      }
      assign(out, parts, val.value);
      skipInline();
      if (src[pos] === ',') {
        pos += 1;
        continue;
      }
      if (src[pos] === '}') {
        pos += 1;
        return { value: out };
      }
      fail('malformed inline table');
      skipToNextLine();
      return { value: out };
    }
  };

  function readValue() {
    skipInline();
    const c = src[pos];
    if (c === '"' || c === "'") return { value: readString(), start: pos };
    if (c === '[') {
      pos += 1;
      return readArray();
    }
    if (c === '{') {
      pos += 1;
      return readInlineTable();
    }
    if (src.startsWith('true', pos)) {
      pos += 4;
      return { value: true, start: pos };
    }
    if (src.startsWith('false', pos)) {
      pos += 5;
      return { value: false, start: pos };
    }
    const start = pos;
    while (pos < src.length && !VALUE_STOP_CHARS.includes(src[pos])) pos += 1;
    if (pos === start) return { bad: true };
    return { value: coerceScalar(src.slice(start, pos)), start };
  }

  function assign(node, parts, value) {
    let target = node;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!isPlainObject(target[parts[i]])) target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  function navigate(parent, parts, arrayTable) {
    let node = parent;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!isPlainObject(node[parts[i]])) node[parts[i]] = {};
      node = node[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (arrayTable) {
      if (!Array.isArray(node[last])) node[last] = [];
      const row = {};
      node[last].push(row);
      return row;
    }
    if (!isPlainObject(node[last])) node[last] = {};
    return node[last];
  }

  while (pos < src.length) {
    skipBlanks();
    if (pos >= src.length) break;

    if (src[pos] === '[') {
      const arrayTable = src.startsWith('[[', pos);
      pos += arrayTable ? 2 : 1;
      const parts = readKeyPath();
      skipInline();
      const closer = arrayTable ? ']]' : ']';
      if (parts === null || !src.startsWith(closer, pos)) {
        fail('malformed table header');
        skipToNextLine();
        continue;
      }
      pos += closer.length;
      skipInline();
      skipComment();
      if (pos < src.length && src[pos] !== '\n') {
        fail('unexpected content after table header');
        skipToNextLine();
      }
      table = navigate(root, parts, arrayTable);
      continue;
    }

    const parts = readKeyPath();
    skipInline();
    if (parts === null || src[pos] !== '=') {
      fail('expected key = value');
      skipToNextLine();
      continue;
    }
    pos += 1;
    const val = readValue();
    if (val.bad) {
      fail('invalid value');
      skipToNextLine();
      continue;
    }
    if (val.resync) continue;
    assign(table, parts, val.value);
    skipInline();
    skipComment();
    if (pos < src.length && src[pos] !== '\n') {
      fail('unexpected content after value');
      skipToNextLine();
    }
  }

  return { value: root, error };
}
