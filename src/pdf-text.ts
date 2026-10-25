/// <reference lib="esnext" />
// PDF -> text lines with pdfjs-dist. The text items of a page are grouped into lines by their baseline
// (y within half a glyph height) and joined left to right; a wide horizontal gap becomes 2 spaces so a
// label and its amount stay apart ("New Balance  $1,234.56"). Used by the browser and by scripts/extract-text.ts
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export type PdfItem = { str: string; x: number; y: number; w: number; h: number };

/** One page's items -> lines, top to bottom. */
export function itemsToLines(items: PdfItem[]): string[] {
  const sorted = items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(2, Math.min(item.h || 8, row?.[0].h || 8) / 2);
    if (row && Math.abs(row[0].y - item.y) <= tolerance) row.push(item);
    else rows.push([item]);
  }
  return rows.map(row => {
    row.sort((a, b) => a.x - b.x);
    let line = '';
    let end = -Infinity;
    for (const item of row) {
      const gap = item.x - end;
      const size = item.h || 8;
      if (line) line += gap > size * 1.2 ? '  ' : gap > size * 0.15 && !line.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '';
      line += item.str;
      end = item.x + item.w;
    }
    return line.replace(/\s+$/, '');
  });
}

export function toPdfItems(items: unknown[]): PdfItem[] {
  return (items as TextItem[]).filter(i => typeof i.str === 'string').map(i => ({
    str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]),
  }));
}

type PdfDocument = { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> };

/** Every page of a loaded document -> text, pages separated by a form feed line. */
export async function documentText(doc: PdfDocument): Promise<string> {
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(itemsToLines(toPdfItems(content.items)).join('\n'));
  }
  return pages.join('\n\f\n');
}
