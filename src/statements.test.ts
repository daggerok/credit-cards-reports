/// <reference types="bun" />
// Real statements, local only: STATEMENTS_DIR=/path/to/pdfs bun test src/statements.test.ts
// Every PDF there must parse with a known issuer and pass the balance check. Nothing is printed but the file
// names and the status; skipped when STATEMENTS_DIR is not set (CI, a fresh clone).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseStatement } from './parser';
import { documentText } from './pdf-text';

const dir = process.env.STATEMENTS_DIR ?? '';
const files = dir ? readdirSync(dir).filter(f => /\.pdf$/i.test(f)).sort() : [];

describe.skipIf(!dir)('real statements in STATEMENTS_DIR', () => {
  test('there are PDFs to check', () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    test(`${file}: VALIDATED`, async () => {
      const doc = await getDocument({ data: new Uint8Array(readFileSync(join(dir, file))), useSystemFonts: true }).promise;
      const s = parseStatement(file, await documentText(doc));
      expect(s.verification).toMatchObject({ status: 'VALIDATED', diff: 0, missing: [] });
      expect(s.minimumPayment).not.toBeNull();
    });
  }
});
