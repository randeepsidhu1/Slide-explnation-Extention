export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 500;
export const MAX_PAGE_TEXT = 100000;

export function validatePdfBytes(bytes) {
  if (!bytes.length) throw new Error("This file is empty. Choose a PDF with at least one page.");
  if (bytes.length > MAX_PDF_BYTES) throw new Error("Choose a PDF smaller than 50 MiB.");
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, 1024));
  if (!header.includes("%PDF-")) throw new Error("This file does not appear to be a PDF. Choose a valid PDF file.");
}

export function textFromContent(content) {
  return content.items.filter((item) => typeof item.str === "string")
    .map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
}

// Promises are shared by rendering, explanations, and the extraction queue.
// Rejecting one page must not prevent extracting the rest of the document.
export function createTextStore(pdf) {
  const pages = new Map();
  function read(pageNumber) {
    if (!pages.has(pageNumber)) {
      pages.set(pageNumber, pdf.getPage(pageNumber).then((page) => page.getTextContent()).then(textFromContent));
    }
    return pages.get(pageNumber);
  }
  return { read };
}

export async function extractDocumentText(pdf, store, { isCurrent = () => true, onProgress = () => {} } = {}) {
  const results = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    if (!isCurrent()) return results;
    try {
      const text = await store.read(pageNumber);
      results.push({ pageNumber, text, status: text ? "text" : "no-text" });
    } catch {
      results.push({ pageNumber, text: "", status: "error" });
    }
    if (!isCurrent()) return results;
    onProgress(results.slice());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return results;
}
