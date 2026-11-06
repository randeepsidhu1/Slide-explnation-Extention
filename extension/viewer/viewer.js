import { getDocument, GlobalWorkerOptions } from "../vendor/pdfjs/build/pdf.min.mjs";
import { MAX_PDF_BYTES, MAX_PAGES, validatePdfBytes, createTextStore, extractDocumentText } from "./document.js";

import { buildIndex, prepareContext } from "./context.js";
import { createChatPanel } from "./chat-panel.js";

GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/build/pdf.worker.min.mjs", import.meta.url).href;
const $ = (id) => document.getElementById(id);
let session = null;
let loadingTask = null;
let documentVersion = 0;
let renderVersion = 0;
let renderTask = null;
let rendering = false;
const chat = createChatPanel({
  buildRequest,
  navigate: async (page) => {
    await renderPage(page);
    $("page-stage").focus();
  }
});

function notice(text = "") {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

function controls() {
  const ready = Boolean(session) && !rendering;
  $("previous").disabled = !ready || session.pageNumber <= 1;
  $("next").disabled = !ready || session.pageNumber >= session.pdf.numPages;
  $("page").disabled = !ready;
  $("zoom").disabled = !ready;
  chat.setAvailability({
    ready: ready && session.renderedPage === session.pageNumber,
    indexed: Boolean(session?.index), page: session?.pageNumber
  });
}

async function openFile(file) {
  if (!file) return;
  const version = ++documentVersion;
  renderVersion++;
  chat.reset();
  renderTask?.cancel();
  session = null;
  rendering = false;
  controls();
  notice();
  $("pdf-canvas").hidden = true;
  $("empty").hidden = true;
  $("filename").textContent = file.name;
  $("file-meta").textContent = "Opening PDF…";
  $("page-text").textContent = "No page selected.";
  $("context").textContent = "No PDF selected";
  $("page-total").textContent = "of 0";
  $("extraction").textContent = "Text extraction has not started.";
  const previous = loadingTask;
  loadingTask = null;
  await previous?.destroy().catch(() => {});
  if (version !== documentVersion) return;

  try {
    if (file.size > MAX_PDF_BYTES) throw new Error("Choose a PDF smaller than 50 MiB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    validatePdfBytes(bytes);
    if (version !== documentVersion) return;
    let needsPassword = false;
    const task = getDocument({
      data: bytes,
      isEvalSupported: false,
      cMapUrl: new URL("../vendor/pdfjs/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
      wasmUrl: new URL("../vendor/pdfjs/wasm/", import.meta.url).href,
      iccUrl: new URL("../vendor/pdfjs/iccs/", import.meta.url).href,
      maxImageSize: 16777216
    });
    loadingTask = task;
    task.onPassword = () => {
      needsPassword = true;
      task.destroy().catch(() => {});
    };
    let pdf;
    try {
      pdf = await task.promise;
    } catch (error) {
      if (needsPassword) throw new Error("This PDF needs a password. Open an unlocked copy for this first version of the viewer.");
      throw error;
    }
    if (version !== documentVersion) return;
    if (pdf.numPages > MAX_PAGES) {
      await task.destroy();
      throw new Error("This first version supports PDFs with up to 500 pages.");
    }
    session = { pdf, pageNumber: 1, text: createTextStore(pdf), version, pages: [] };
    $("page").max = pdf.numPages;
    $("page-total").textContent = `of ${pdf.numPages}`;
    $("file-meta").textContent = `${pdf.numPages} pages · ${(file.size / 1024 / 1024).toFixed(1)} MiB · Local to this tab`;
    $("zoom").value = "fit";
    const active = session;
    // This queue only extracts locally; it makes no AI or network requests.
    extractDocumentText(pdf, active.text, {
      isCurrent: () => session === active,
      onProgress: (pages) => {
        active.pages = pages;
        if (pages.length === pdf.numPages) active.index = buildIndex(pages);
        const unreadable = pages.filter((page) => page.status === "no-text").length;
        const failed = pages.filter((page) => page.status === "error").length;
        $("extraction").textContent = `Read ${pages.length} of ${pdf.numPages} pages locally. ${unreadable} without extractable text; ${failed} failed. Scanned pages can still be explained using their image. Whole-PDF questions search extracted text; pages without text cannot be searched. Use their page image in Current page mode.`;
        controls();
      }
    }).catch(() => {});
    await renderPage(1);
  } catch (error) {
    if (version !== documentVersion) return;
    notice(error.name === "InvalidPDFException" ? "This PDF is damaged or unsupported. Choose another PDF." : error.message || "Could not open this PDF.");
    $("file-meta").textContent = "Could not open PDF";
    $("empty").hidden = false;
    controls();
  }
}

async function renderPage(pageNumber) {
  const active = session;
  if (!active || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > active.pdf.numPages) return;
  const version = ++renderVersion;
  if (active.pageNumber !== pageNumber) chat.cancel("Stopped because you changed pages. Your earlier answers are still available.");
  active.pageNumber = pageNumber;
  rendering = true;
  controls();
  $("page").value = pageNumber;
  $("context").textContent = `Current page · ${pageNumber} of ${active.pdf.numPages}`;
  $("pdf-canvas").hidden = true;
  $("render-status").textContent = `Rendering page ${pageNumber}…`;
  $("render-status").hidden = false;
  $("page-text").textContent = "Reading page text…";
  const previous = renderTask;
  previous?.cancel();
  await previous?.promise.catch(() => {});
  if (session !== active || version !== renderVersion) return;
  try {
    const page = await active.pdf.getPage(pageNumber);
    if (session !== active || version !== renderVersion) return;
    const natural = page.getViewport({ scale: 1 });
    const fit = Math.max(0.1, ($("page-stage").clientWidth - 56) / natural.width);
    const scale = $("zoom").value === "fit" ? fit : Number($("zoom").value);
    // Bound actual canvas dimensions even for pathological PDF page sizes.
    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    const bounded = Math.min(scale * resolution, 4096 / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale: bounded });
    const canvas = $("pdf-canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const displayScale = Math.min(scale, 4096 / Math.max(natural.width, natural.height));
    canvas.style.width = `${natural.width * displayScale}px`;
    canvas.style.height = `${natural.height * displayScale}px`;
    const task = page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "rgb(255,255,255)" });
    renderTask = task;
    await task.promise;
    if (session !== active || version !== renderVersion) return;
    canvas.hidden = false;
    $("page-stage").scrollTo(0, 0);
    $("render-status").hidden = true;
    active.renderedPage = pageNumber;
    active.text.read(pageNumber).then((text) => {
      if (session === active && version === renderVersion) $("page-text").textContent = text || "No extractable text on this page. Its image will be used for the explanation.";
    }).catch(() => {
      if (session === active && version === renderVersion) $("page-text").textContent = "Text extraction failed for this page. Its image will be used for the explanation.";
    });
  } catch (error) {
    if (session !== active || version !== renderVersion || error.name === "RenderingCancelledException") return;
    active.renderedPage = null;
    $("render-status").textContent = "This page could not be rendered. Try another page or PDF.";
  } finally {
    if (session === active && version === renderVersion) {
      rendering = false;
      controls();
      $("explain").disabled ||= active.renderedPage !== pageNumber;
    }
  }
}

async function renderPageImage(pdf, pageNumber, signal) {
  signal.throwIfAborted();
  const page = await pdf.getPage(pageNumber);
  signal.throwIfAborted();
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(natural.width, natural.height)) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "rgb(255,255,255)" });
  const abort = () => task.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try { await task.promise; }
  finally { signal.removeEventListener("abort", abort); }
  signal.throwIfAborted();
  const data = canvas.toDataURL("image/jpeg", 0.8);
  canvas.width = canvas.height = 0;
  if (data.length > 3 * 1024 * 1024) throw new Error("A page image is too large. Try a different page or PDF.");
  return { sourceId: `p${pageNumber}_image`, data };
}

async function buildRequest({ question, mode, page, history, previousSources, signal }) {
  const active = session;
  if (!active) throw new Error("Open a PDF first.");
  if (mode === "document" && !active.index) throw new Error("Wait for all pages to finish reading before asking a whole-PDF question.");
  let index = active.index;
  if (!index) {
    const text = await active.text.read(page).catch(() => "");
    index = buildIndex([{ pageNumber: page, text, status: text ? "text" : "no-text" }]);
  }
  const prepared = prepareContext({ index, mode, question, currentPage: page, history, previousSources });
  prepared.receipt.totalPages = active.pdf.numPages;
  const images = [];
  for (const number of prepared.imagePages) {
    signal.throwIfAborted();
    images.push(await renderPageImage(active.pdf, number, signal));
  }
  if (session !== active) throw new Error("The active PDF changed. Ask again in the new document.");
  return {
    sources: prepared.sources, receipt: prepared.receipt,
    payload: { question, mode, currentPage: page, totalPages: active.pdf.numPages, sources: prepared.sources, images, history }
  };
}

$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  $("file").value = "";
  openFile(file);
});
$("previous").addEventListener("click", () => renderPage(session.pageNumber - 1));
$("next").addEventListener("click", () => renderPage(session.pageNumber + 1));
$("page-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = Number($("page").value);
  if (session && Number.isInteger(value) && value >= 1 && value <= session.pdf.numPages) renderPage(value);
  else if (session) $("page").value = session.pageNumber;
});
$("zoom").addEventListener("change", () => renderPage(session.pageNumber));
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "explain-pdf-page") chat.explain();
});
window.addEventListener("pagehide", () => {
  chat.cancel();
  loadingTask?.destroy().catch(() => {});
});
