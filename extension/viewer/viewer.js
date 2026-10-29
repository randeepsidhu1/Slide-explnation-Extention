import { getDocument, GlobalWorkerOptions } from "../vendor/pdfjs/build/pdf.min.mjs";
import { MAX_PDF_BYTES, MAX_PAGES, MAX_PAGE_TEXT, validatePdfBytes, createTextStore, extractDocumentText } from "./document.js";

GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/build/pdf.worker.min.mjs", import.meta.url).href;
const $ = (id) => document.getElementById(id);
let session = null;
let loadingTask = null;
let documentVersion = 0;
let renderVersion = 0;
let renderTask = null;
let rendering = false;
let request = null;
let requestVersion = 0;

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
  $("explain").disabled = !ready || Boolean(request);
  $("stop").hidden = !request;
}

function cancelRequest() {
  requestVersion++;
  request?.abort();
  request = null;
  controls();
}

async function openFile(file) {
  if (!file) return;
  const version = ++documentVersion;
  renderVersion++;
  cancelRequest();
  renderTask?.cancel();
  session = null;
  rendering = false;
  controls();
  notice();
  $("pdf-canvas").hidden = true;
  $("empty").hidden = true;
  $("filename").textContent = file.name;
  $("file-meta").textContent = "Opening PDF…";
  $("answer").textContent = "Your explanation will appear here.";
  $("answer").classList.remove("error");
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
    session = { pdf, pageNumber: 1, text: createTextStore(pdf), version };
    $("page").max = pdf.numPages;
    $("page-total").textContent = `of ${pdf.numPages}`;
    $("file-meta").textContent = `${pdf.numPages} pages · ${(file.size / 1024 / 1024).toFixed(1)} MiB · Local to this tab`;
    $("zoom").value = "fit";
    const active = session;
    // This queue only extracts locally; it makes no AI or network requests.
    extractDocumentText(pdf, active.text, {
      isCurrent: () => session === active,
      onProgress: (pages) => {
        const unreadable = pages.filter((page) => page.status === "no-text").length;
        const failed = pages.filter((page) => page.status === "error").length;
        $("extraction").textContent = `Read ${pages.length} of ${pdf.numPages} pages locally. ${unreadable} without extractable text; ${failed} failed. Scanned pages can still be explained using their image. OCR and document-wide questions are not available yet.`;
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
  cancelRequest();
  active.pageNumber = pageNumber;
  rendering = true;
  controls();
  $("page").value = pageNumber;
  $("context").textContent = `Current page · ${pageNumber} of ${active.pdf.numPages}`;
  $("answer").textContent = "Your explanation will appear here.";
  $("answer").classList.remove("error");
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

async function explainPage() {
  const active = session;
  if (!active || rendering || request || active.renderedPage !== active.pageNumber) return;
  const pageNumber = active.pageNumber;
  const version = ++requestVersion;
  const controller = new AbortController();
  request = controller;
  controls();
  $("answer").textContent = `Reading page ${pageNumber}…`;
  $("answer").classList.remove("error");
  const timeout = setTimeout(() => controller.abort("timeout"), 70000);
  try {
    const text = await active.text.read(pageNumber).catch(() => "");
    if (version !== requestVersion) return;
    if (text.length > MAX_PAGE_TEXT) throw new Error("This page contains too much text to send safely. Try screenshot mode or a smaller PDF page.");
    // Render at a stable resolution independent of display zoom.
    const page = await active.pdf.getPage(pageNumber);
    if (version !== requestVersion) return;
    controller.signal.throwIfAborted();
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(natural.width, natural.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "rgb(255,255,255)" });
    const abortRender = () => task.cancel();
    controller.signal.addEventListener("abort", abortRender, { once: true });
    try {
      controller.signal.throwIfAborted();
      await task.promise;
    } finally {
      controller.signal.removeEventListener("abort", abortRender);
    }
    if (version !== requestVersion) return;
    const response = await fetch("http://127.0.0.1:8787/explain", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: canvas.toDataURL("image/jpeg", 0.85), page: { number: pageNumber, total: active.pdf.numPages, text } }),
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Backend error (${response.status}).`);
    if (typeof result.explanation !== "string") throw new Error("The backend returned an invalid explanation.");
    if (version !== requestVersion || session !== active) return;
    $("answer").textContent = result.explanation;
  } catch (error) {
    if (version !== requestVersion || session !== active) return;
    $("answer").classList.add("error");
    $("answer").textContent = controller.signal.aborted ? "The request timed out. Try again." :
      error instanceof TypeError && error.message === "Failed to fetch" ? "Could not reach your local backend. Start it with npm start inside backend/ and try again." : error.message || "Could not explain this page.";
  } finally {
    clearTimeout(timeout);
    if (version === requestVersion) {
      request = null;
      controls();
    }
  }
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
$("explain").addEventListener("click", explainPage);
$("stop").addEventListener("click", () => {
  cancelRequest();
  $("answer").textContent = "Request stopped. You can explain this page again.";
});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "explain-pdf-page") explainPage();
});
window.addEventListener("pagehide", () => {
  cancelRequest();
  loadingTask?.destroy().catch(() => {});
});
