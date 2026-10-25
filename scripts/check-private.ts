/// <reference types="bun" />
// Statements never get into a commit, the repo or the public site (same guard as fidelity-reports):
//   bun scripts/check-private.ts --check          exit 1 while any file git would commit (tracked or new) is a PDF
//                                                 or holds a card-number-like value
//   bun scripts/check-private.ts --pre-commit     the same over the staged files (the pre-commit hook)
//   bun scripts/check-private.ts --check-history  the same over every commit (the pre-push hook and CI)
//   bun scripts/check-private.ts --check-dist     the same over the built site (dist/), after every build
//   bun scripts/check-private.ts --check-hooks    exit 1 unless core.hooksPath = .githooks (build, serve and test run
//                                                 it; skipped on CI, which runs --check and --check-history instead)
// A card-number-like value: 4 groups of digits split by spaces or dashes (1234 5678 9012 3456) or a run of 15-16
// digits (not the fraction of a decimal, minified code is full of those), either one passing the Luhn check.
// Values are never printed, only the file and the line.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// __dirname instead of import.meta: the owner's IDE checks this file with the TypeScript defaults (ES5, commonjs)
const ROOT = join(__dirname, '..');
/** Never scanned: the lockfile (hashes) and binaries. */
const SKIP = /(^|\/)bun\.lock$|\.(ico|png|jpe?g|gif|woff2?)$/i;
const STATEMENT = /\.pdf$/i;

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** 1-based numbers of the lines with a card-number-like value. */
export function cardLikeLines(text: string): number[] {
  const re = /(?<![\dA-Za-z.])(?:\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{3,4}|\d{4}[ -]\d{6}[ -]\d{5}|\d{15,16})(?![\dA-Za-z.])/g;
  const lines: number[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of Array.from(line.matchAll(re))) {
      if (luhn(m[0].replace(/\D/g, ''))) { lines.push(i + 1); break; }
    }
  });
  return lines;
}

function git(args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd: ROOT });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

/** Problems of one file: a PDF, or the lines with card-like numbers. */
function problems(path: string, read: () => string): string[] {
  if (STATEMENT.test(path)) return [`${path}: a PDF (statements are never committed)`];
  if (SKIP.test(path)) return [];
  let text = '';
  try { text = read(); } catch { return []; } // deleted in the working tree
  const lines = cardLikeLines(text);
  return lines.length ? [`${path}: card-number-like value on ${lines.length} line(s), first at line ${lines[0]}`] : [];
}

function walk(dir: string): string[] {
  let files: string[] = [];
  try { readdirSync(dir); } catch { return files; }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    files = statSync(path).isDirectory() ? [...files, ...walk(path)] : [...files, path];
  }
  return files;
}

export function hooksProblem(): string {
  if (process.env.CI) return '';
  const path = Bun.spawnSync(['git', 'config', 'core.hooksPath'], { cwd: ROOT }).stdout.toString().trim();
  return path === '.githooks' ? '' : `git hooks are off (core.hooksPath is "${path}"): run bun install (or git config core.hooksPath .githooks)`;
}

function finish(found: string[], ok: string, bad: string): number {
  for (const line of found) console.log(`PRIVATE ${line}`);
  console.log(found.length ? bad : ok);
  return found.length ? 1 : 0;
}

function main(argv: string[]): number {
  if (argv.includes('--check-hooks')) {
    const problem = hooksProblem();
    console.log(problem ? `HOOKS: ${problem}` : process.env.CI ? 'hooks: skipped on CI (check runs instead)' : 'hooks: pre-commit and pre-push are on');
    return problem ? 1 : 0;
  }
  if (argv.includes('--pre-commit')) {
    const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
    return finish(staged.flatMap(p => problems(p, () => git(['show', `:${p}`]))), 'pre-commit: no statements, no card numbers', 'commit refused: unstage those files (git restore --staged <file>)');
  }
  if (argv.includes('--check-history')) {
    const found = new Set<string>();
    for (const commit of git(['rev-list', '--all']).split('\n').filter(Boolean)) {
      for (const p of git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean)) {
        for (const line of problems(p, () => git(['show', `${commit}:${p}`]))) found.add(`${commit.slice(0, 7)} ${line}`);
      }
    }
    return finish(Array.from(found), 'history: no statements, no card numbers', 'the history holds private data: do not push it');
  }
  if (argv.includes('--check-dist')) {
    const found = walk(join(ROOT, 'dist')).flatMap(f => problems(relative(ROOT, f), () => readFileSync(f, 'utf8')));
    return finish(found, 'dist: no statements, no card numbers', 'the built site holds private data: do not publish it');
  }
  const files = git(['ls-files', '-co', '--exclude-standard']).split('\n').filter(Boolean);
  return finish(files.flatMap(p => problems(p, () => readFileSync(join(ROOT, p), 'utf8'))), 'repo: no statements, no card numbers', 'private data in the repo: remove it before committing');
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
