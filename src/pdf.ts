/// <reference path="./pdfjs-min.d.ts" />
// Browser side of the PDF engine: pdfjs-dist reads the file in its own worker, pdf-text.ts turns it into lines
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.min.mjs';
import { documentText } from './pdf-text';

// scripts/copy-worker.ts puts the prebuilt worker next to index.html (Parcel would break it by bundling it)
GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).toString();

/** The text of every page of a PDF file, pages separated by a form feed line. */
export async function pdfText(file: File): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return await documentText(await task.promise);
  } finally {
    void task.destroy();
  }
}
