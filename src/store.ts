/// <reference lib="esnext" />
// The loaded files survive a reload: the name and the text lines of every file that was read are kept in
// localStorage of this site (this browser only, nothing leaves it). The fields are parsed again from the text on
// the next visit, so a parser fix applies to the files kept before it. Clear forgets them.

export type SavedFile = { name: string; text: string };

/** Files worth keeping: the ones pdf.js read (a PDF that could not be read has no text and is loaded again). */
export function toSaved(entries: Array<{ name: string; status: string; text: string }>): SavedFile[] {
  return entries.filter(e => e.status !== 'parsing' && e.text).map(e => ({ name: e.name, text: e.text }));
}

/** What localStorage gave back, checked field by field: anything else (old shape, hand-edited) is dropped. */
export function fromSaved(raw: unknown): SavedFile[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedFile[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const f = item as Partial<SavedFile> | null;
    if (!f || typeof f.name !== 'string' || !f.name || typeof f.text !== 'string' || !f.text || seen.has(f.name)) continue;
    seen.add(f.name);
    out.push({ name: f.name, text: f.text });
  }
  return out;
}
