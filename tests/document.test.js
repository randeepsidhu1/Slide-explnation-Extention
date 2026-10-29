import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import { validatePdfBytes, createTextStore, extractDocumentText } from "../extension/viewer/document.js";
import { makePdf } from "./fixtures.mjs";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;

test("parses a real multi-page PDF and extracts text beyond the first page", async () => {
  const bytes = new Uint8Array(makePdf());
  validatePdfBytes(bytes);
  const task = getDocument({ data: bytes, isEvalSupported: false, standardFontDataUrl: fileURLToPath(new URL("../extension/vendor/pdfjs/standard_fonts/", import.meta.url)) });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 3);
    const store = createTextStore(pdf);
    const progress = [];
    const pages = await extractDocumentText(pdf, store, { onProgress: (pages) => progress.push(pages.length) });
    assert.match(pages[0].text, /Fractions/);
    assert.match(pages[2].text, /Photosynthesis/);
    assert.deepEqual(pages.map((page) => page.pageNumber), [1, 2, 3]);
    assert.deepEqual(progress, [1, 2, 3]);
  } finally {
    await task.destroy();
  }
});

test("shares page extraction and records empty/failed pages without losing later pages", async () => {
  const reads = [];
  const pdf = { numPages: 3, async getPage(number) {
    reads.push(number);
    if (number === 2) throw new Error("Damaged page");
    return { getTextContent: async () => ({ items: number === 1 ? [] : [{ str: "Last page", hasEOL: true }] }) };
  } };
  const store = createTextStore(pdf);
  await store.read(1);
  const pages = await extractDocumentText(pdf, store);
  assert.deepEqual(reads, [1, 2, 3]);
  assert.deepEqual(pages.map((page) => page.status), ["no-text", "error", "text"]);
  assert.equal(pages[2].text, "Last page");
});

test("stops extracting an old document when a new document replaces it", async () => {
  const pdf = { numPages: 5 };
  let active = true;
  let reads = 0;
  const result = await extractDocumentText(pdf, { async read() { reads++; return "Text"; } }, {
    isCurrent: () => active,
    onProgress: () => { active = false; }
  });
  assert.equal(reads, 1);
  assert.equal(result.length, 1);
});

test("rejects empty, non-PDF, and oversized files", () => {
  assert.throws(() => validatePdfBytes(new Uint8Array()), /empty/);
  assert.throws(() => validatePdfBytes(new TextEncoder().encode("This is not a PDF")), /valid PDF/);
  assert.throws(() => validatePdfBytes(new Uint8Array(50 * 1024 * 1024 + 1)), /50 MiB/);
});
