// Text of a PDF, extracted in code (unpdf). The model only ever receives this text, never the file.
import { extractText, getDocumentProxy } from 'unpdf';

/** Text of every page, or an empty string if the file is not a readable PDF or contains no text. */
export async function extractPdfText(pdf: Uint8Array): Promise<string> {
  try {
    const document = await getDocumentProxy(new Uint8Array(pdf));
    const { text } = await extractText(document, { mergePages: true });
    return text.trim();
  } catch {
    return '';
  }
}
