// Reads the text out of a PDF. Scanned PDFs have no text layer, so this returns "" for them
// and the Classifier Agent falls back to OCR (Claude reading the page image).
import { extractText, getDocumentProxy } from "unpdf";

export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/[ \t]+/g, " ").trim();
  } catch {
    return "";
  }
}

export function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}
