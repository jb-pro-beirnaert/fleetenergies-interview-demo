// Minimal typing of the part of pdfmake 0.3 used by `invoice-pdf.ts` (the package ships no types).
declare module 'pdfmake' {
  interface OutputDocument {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfMake {
    addFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(policy: (url: string) => boolean): void;
    setLocalAccessPolicy(policy: (path: string) => boolean): void;
    createPdf(definition: Record<string, unknown>): OutputDocument;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}
