import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseToml } from '../src/toml.js';

test('parses the shapes real agent configs use', () => {
  const { value, error } = parseToml(`
# comment
model = "gpt-5"
model_reasoning_effort = "high"
enabled = false
retries = 3
ratio = 1.5

[windows]
sandbox = "unelevated"

[projects.'c:\\repo\\dot']
trust_level = "trusted"

[providers."managed:kimi-code"]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"

[providers."managed:kimi-code".oauth]
storage = "file"

[models."kimi-code/k3"]
provider = "managed:kimi-code"
max_context_size = 1048576
capabilities = [
  "thinking",
  "always_thinking",
]
inline = { a = 1, b = "two" }
`);
  assert.equal(error, null);
  assert.deepEqual(value, {
    model: 'gpt-5',
    model_reasoning_effort: 'high',
    enabled: false,
    retries: 3,
    ratio: 1.5,
    windows: { sandbox: 'unelevated' },
    projects: { 'c:\\repo\\dot': { trust_level: 'trusted' } },
    providers: {
      'managed:kimi-code': {
        type: 'kimi',
        base_url: 'https://api.kimi.com/coding/v1',
        oauth: { storage: 'file' },
      },
    },
    models: {
      'kimi-code/k3': {
        provider: 'managed:kimi-code',
        max_context_size: 1048576,
        capabilities: ['thinking', 'always_thinking'],
        inline: { a: 1, b: 'two' },
      },
    },
  });
});

test('parses literal, basic and multi-line strings', () => {
  const { value, error } = parseToml(`
basic = "a\\tb\\n"
literal = 'C:\\path\\no-escapes'
multi_basic = """
line1
line2"""
multi_literal = '''
raw\\n
'''
`);
  assert.equal(error, null);
  assert.equal(value.basic, 'a\tb\n');
  assert.equal(value.literal, 'C:\\path\\no-escapes');
  assert.equal(value.multi_basic, 'line1\nline2');
  assert.equal(value.multi_literal, 'raw\\n\n');
});

test('dotted keys and array-of-tables land in nested objects', () => {
  const { value, error } = parseToml(`
a.b.c = 1

[[permission.rules]]
allow = "bash"

[[permission.rules]]
deny = "rm"
`);
  assert.equal(error, null);
  assert.deepEqual(value.a, { b: { c: 1 } });
  assert.deepEqual(value.permission, { rules: [{ allow: 'bash' }, { deny: 'rm' }] });
});

test('malformed input never throws and reports the first error', () => {
  const { value, error } = parseToml('ok = "fine"\nbroken = [1, 2\nafter = "still parsed"');
  assert.match(error, /offset \d+/);
  assert.equal(value.ok, 'fine');
  // The array recovers and parsing continues on the next key.
  assert.equal(value.after, 'still parsed');
});

test('empty and non-string input parse to an empty object', () => {
  assert.deepEqual(parseToml('').value, {});
  assert.equal(parseToml('').error, null);
  assert.deepEqual(parseToml(undefined).value, {});
});
