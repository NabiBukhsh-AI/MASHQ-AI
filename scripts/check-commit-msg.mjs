#!/usr/bin/env node
// commit-msg hook: rejects em dashes and enforces Conventional Commit subject prefixes.
// Wire it with simple-git-hooks: "commit-msg": "node scripts/check-commit-msg.mjs \"$1\""
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('check-commit-msg: pass the commit message file path.');
  process.exit(1);
}
const message = fs.readFileSync(file, 'utf8');
const subject = message.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
const problems = [];

if (message.includes('\u2014')) problems.push('it contains an em dash');
const allowed = /^((feat|fix|perf|refactor|docs|test|build|ci|chore)(\([\w./-]+\))?!?: \S|Merge |Revert ")/;
if (!allowed.test(subject)) {
  problems.push('the subject must start with feat:, fix:, perf:, refactor:, docs:, test:, build:, ci: or chore:');
}

if (problems.length) {
  console.error(`Commit rejected: ${problems.join('; ')}.\nSubject: ${subject}`);
  process.exit(1);
}
