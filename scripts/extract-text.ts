/// <reference types="node" />
// Prints the text lines of PDF statements the way the browser sees them (for writing a parser of a new issuer):
//   bun scripts/extract-text.ts a.pdf [b.pdf ...] [--out dir]
// Statements are private: write the text outside the repo (the default is stdout).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { documentText } from '../src/pdf-text';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : '';
if (out) mkdirSync(out, { recursive: true });
for (const file of args) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
  const text = await documentText(doc);
  if (out) writeFileSync(join(out, `${basename(file)}.txt`), text);
  else console.log(`===== ${file}\n${text}`);
}
