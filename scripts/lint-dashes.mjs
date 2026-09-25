#!/usr/bin/env node
// Fails when a tracked or new (not ignored) text file contains an em dash (U+2014).
// Runs in CI and in the pre-commit hook, so it applies to every tool and model.
// Excluded: AGENTS.md (written by Next.js, contains em dashes by design), pnpm-lock.yaml,
// and eval/fixtures/external/ (third-party documents kept verbatim for testing).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const EXCLUDE = [/(^|\/)AGENTS\.md$/, /(^|\/)pnpm-lock\.yaml$/, /^eval\/fixtures\/external\//];
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|pdf|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf|zip|gz|pptx|docx|xlsx)$/i;

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let count = 0;
for (const file of files) {
  if (EXCLUDE.some((re) => re.test(file)) || BINARY.test(file)) continue;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('\u2014')) continue;
  text.split('\n').forEach((line, i) => {
    if (!line.includes('\u2014')) return;
    count += 1;
    if (count <= 50) console.error(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (count) {
  console.error(`\n${count} line(s) contain an em dash. Use a comma, colon, parentheses or a new sentence.`);
  process.exit(1);
}
console.log('lint:dashes: no em dashes found.');
