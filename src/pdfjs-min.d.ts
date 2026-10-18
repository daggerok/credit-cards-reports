// The minified ES build of pdf.js (src/pdf.ts imports it: Parcel fails on the source maps of the plain build)
// has the API of the package entry, which ships the types.
declare module 'pdfjs-dist/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
