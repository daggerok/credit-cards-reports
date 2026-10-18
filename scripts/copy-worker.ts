/// <reference types="bun" />
// Copies the pdf.js worker into dist/ as it is (prebuilt and minified by pdf.js). Bundled by Parcel it breaks
// ("Private field '#T' must be declared in an enclosing class"), so src/pdf.ts loads it from the page folder
// instead; runs before serve and after build, like ncp copies data/ in fidelity-reports.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), join(root, 'dist/pdf.worker.min.mjs'));
console.log('dist/pdf.worker.min.mjs');
