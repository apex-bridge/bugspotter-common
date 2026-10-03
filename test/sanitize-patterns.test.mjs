// Runs against the built output: `pnpm build && pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PATTERNS } from '../dist/index.js';

const redactEmails = (text) => text.replace(DEFAULT_PATTERNS.email.regex, '[E]');

test('email: matches common address shapes', () => {
  const cases = [
    ['mail jane.doe@example.com now', 'mail [E] now'],
    ['user+tag@mail.co.uk', '[E]'],
    ['a.b@c.d.e.fr,', '[E],'],
    ['<x_y-z@sub.domain.org>', '<[E]>'],
    ['first@a.io and second@b.io', '[E] and [E]'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactEmails(input), expected, input);
  }
});

test('email: leaves non-addresses alone', () => {
  for (const input of ['not an email', 'foo@bar', '@example.com', 'a@b.c']) {
    assert.equal(redactEmails(input), input, input);
  }
});

// Page text can be attacker-influenced (user-generated content), and the
// SDK runs these patterns on every DOM text node on the main thread. A
// pattern with super-linear backtracking freezes the page.
const ADVERSARIAL = {
  'a.': (n) => 'a.'.repeat(n / 2),
  'a@a.': (n) => 'a@' + 'a.'.repeat(n / 2),
  '1.2.': (n) => '1.2.'.repeat(n / 4),
  'aB3-': (n) => 'aB3-'.repeat(n / 4),
  digits: (n) => '1'.repeat(n),
  'digits-': (n) => '1-'.repeat(n / 2),
  'a@': (n) => 'a@'.repeat(n / 2),
};

test('all default patterns run in linear time on adversarial input', () => {
  const size = 50_000;
  for (const [name, { regex }] of Object.entries(DEFAULT_PATTERNS)) {
    for (const [label, make] of Object.entries(ADVERSARIAL)) {
      const input = make(size);
      const start = performance.now();
      input.replace(regex, '');
      const ms = performance.now() - start;
      assert.ok(ms < 200, `${name} on ${label} x${size}: ${ms.toFixed(0)}ms`);
    }
  }
});
