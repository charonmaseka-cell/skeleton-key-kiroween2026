declare module '*?url' {
  const url: string;
  export default url;
}
// The standard (browser) build of PDF.js ships no per-file declarations; its API is the one the types package describes.
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist/legacy/build/pdf.mjs';
}
