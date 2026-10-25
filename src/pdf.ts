/// <reference lib="esnext" />
/// <reference path="./pdfjs-min.d.ts" />
// Browser side of the PDF engine: pdfjs-dist reads the file in its own worker, pdf-text.ts turns it into lines.
// main.tsx imports this module lazily (await import('./pdf')) so pdf.js stays out of the first page load.
import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist/build/pdf.min.mjs';
import { limiter } from './limit';
import { documentText } from './pdf-text';

// scripts/copy-worker.ts puts the prebuilt worker next to index.html (Parcel would break it by bundling it)
GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).toString();

// a few files at a time (each holds its bytes and a parsed document in memory), all in one worker thread:
// pdf.js starts a new worker per document otherwise. A loading task given a worker does not destroy it,
// so the worker lives as long as the page
const limit = limiter(3);
let worker: PDFWorker | null = null;

/** The text of every page of a PDF file, pages separated by a form feed line. */
export function pdfText(file: File): Promise<string> {
  return limit(async () => {
    worker ??= new PDFWorker();
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), worker });
    try {
      return await documentText(await task.promise);
    } finally {
      void task.destroy();
    }
  });
}
