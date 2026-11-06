import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { makePdf } from "./fixtures.mjs";
import { createServer } from "../backend/server.js";

const profile = await mkdtemp(join(tmpdir(), "slide-study-browser-"));
const extension = resolve("extension");
let context, server;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  const requests = [];
  let mode = "success";
  let release;
  // Exercise the real backend request/citation contract while replacing only AI inference.
  server = createServer({ allowedExtensionId: extensionId, chat: async (payload) => {
    const behavior = mode;
    if (behavior === "slow") await new Promise((resolve) => { release = resolve; });
    if (behavior === "error") throw new Error("Gemini free-tier limit reached.");
    const source = payload.mode === "document" ? payload.sources.find((source) => source.page === payload.totalPages && source.text) || payload.sources[0] : payload.sources[0];
    return `Answer about page ${source.page} [${source.id}].${behavior === "unsafe" ? " <img src=x onerror=bad()> [p999_c1]" : ""}`;
  } });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const mockBase = `http://127.0.0.1:${server.address().port}`;
  await context.route("http://127.0.0.1:8787/chat", async (route) => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    const response = await fetch(`${mockBase}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: `chrome-extension://${extensionId}` }, body: JSON.stringify(payload)
    });
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() }).catch(() => {});
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const created = context.waitForEvent("page");
  await popup.locator("#pdf").click();
  const page = await created;
  await page.waitForURL(`chrome-extension://${extensionId}/viewer/viewer.html`);
  const answers = page.locator(".assistant-answer");
  async function waitAnswer(text) {
    await page.waitForFunction((text) => document.querySelector(".turn:last-child .assistant-answer")?.textContent.includes(text), text);
    await page.locator("#send:not([disabled])").waitFor();
  }
  async function ask(question) {
    await page.locator("#question").fill(question);
    await page.locator("#send").click();
  }
  async function waitRelease() {
    const deadline = Date.now() + 10000;
    while (!release && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(release, "The delayed request reached the backend");
  }
  async function openPdf(name, texts) {
    await page.locator("#file").setInputFiles({ name, mimeType: "application/pdf", buffer: makePdf(texts) });
    await page.locator("#pdf-canvas:not([hidden])").waitFor();
    await page.waitForFunction(() => !document.getElementById("whole-document").disabled);
  }
  await openPdf("lesson.pdf");
  assert.match(await page.locator("#page-text").textContent(), /Fractions/);
  assert.equal(requests.length, 0, "Import, indexing, and rendering do not call AI");
  await page.locator("#next").click();
  await page.waitForFunction(() => document.getElementById("page-text").textContent.includes("Gravity"));
  await page.locator("#explain").click();
  await waitAnswer("Answer about page 2");
  assert.ok(requests[0].sources.every((source) => source.page === 2));
  assert.match(requests[0].sources[0].text, /Gravity/);
  assert.match(requests[0].images[0].data, /^data:image\/jpeg;base64,/);
  await page.locator("#previous").click();
  await page.waitForFunction(() => document.getElementById("page-text").textContent.includes("Fractions"));
  assert.equal(await answers.count(), 1, "Page navigation retains the transcript");
  assert.match(await answers.first().textContent(), /Answer about page 2/);
  await page.locator("#scope").selectOption("document");
  await ask("How does photosynthesis transform light?");
  await waitAnswer("Answer about page 3");
  assert.ok(requests[1].sources.some((source) => source.page === 3 && source.text.includes("Photosynthesis")));
  assert.equal(requests[1].history.length, 2);
  await page.locator(".turn:last-child .citation").click();
  await page.waitForFunction(() => document.getElementById("page").value === "3" && !document.getElementById("explain").disabled);
  assert.equal(await answers.count(), 2);
  await page.locator('.follow-up[data-question="Why is that the case?"]').click();
  await waitAnswer("Answer about page 3");
  assert.equal(requests[2].history.length, 4);
  assert.match(requests[2].history[2].text, /photosynthesis/);
  assert.match(await page.locator(".turn:last-child .receipt").textContent(), /Earlier exchanges included: 2/);
  if (process.env.STUDY_SCREENSHOT) await page.screenshot({ path: process.env.STUDY_SCREENSHOT, fullPage: true });
  await page.locator("#scope").selectOption("page");
  await ask("Explain the terms here.");
  await waitAnswer("Answer about page 3");
  assert.ok(requests.at(-1).sources.every((source) => source.page === 3), "Current-page evidence stays scoped despite whole-PDF history");
  await page.locator("#zoom").selectOption("1.5");
  await page.locator("#explain:not([disabled])").waitFor();
  assert.equal(await answers.count(), 4, "Zoom preserves chat history");
  mode = "unsafe";
  await ask("Show a reference.");
  await waitAnswer("source unavailable");
  assert.equal(await page.locator("#conversation img, #conversation script").count(), 0);
  assert.match(await page.locator(".turn:last-child .citation-warning").textContent(), /unsupported/);
  assert.equal(await page.locator(".turn:last-child .citation").count(), 1);
  mode = "error";
  await ask("Question that fails");
  await waitAnswer("free-tier limit");
  mode = "success";
  await page.locator(".turn:last-child .retry").click();
  await waitAnswer("Answer about page 3");
  assert.ok(!requests.at(-1).history.some((message) => message.text === "Question that fails"));
  mode = "slow";
  release = null;
  await ask("A request I will stop");
  await waitRelease();
  await page.locator("#stop").click();
  release();
  await waitAnswer("Request stopped");
  assert.ok(await answers.count() >= 8);
  mode = "slow";
  release = null;
  await ask("A request interrupted by navigation");
  await waitRelease();
  await page.locator("#previous").click();
  release();
  await waitAnswer("Stopped because you changed pages");
  assert.match(await answers.first().textContent(), /Answer about page 2/);
  await page.locator("#new-chat").click();
  assert.equal(await answers.count(), 0);
  mode = "success";
  await ask("Start again");
  await waitAnswer("Answer about page 2");
  assert.equal(requests.at(-1).history.length, 0);
  await page.locator("#file").setInputFiles({ name: "not-a-pdf.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") });
  await page.waitForFunction(() => document.getElementById("notice").textContent.includes("valid PDF"));
  await openPdf("blank.pdf", [""]);
  await page.waitForFunction(() => document.getElementById("page-text").textContent.includes("No extractable text"));
  assert.equal(await answers.count(), 0, "Another document cannot inherit the prior chat");
  await page.locator("#explain").click();
  await waitAnswer("Answer about page 1");
  assert.equal(requests.at(-1).sources[0].id, "p1_image");
  const longPages = Array.from({ length: 30 }, (_, i) => i === 29 ? "Photosynthesis uses sunlight to make chemical energy. ".repeat(80) : "Ordinary background material about fractions and numbers. ".repeat(80));
  await openPdf("long.pdf", longPages);
  await page.locator("#scope").selectOption("document");
  await ask("How does photosynthesis use sunlight?");
  await waitAnswer("Answer about page 30");
  assert.ok(requests.at(-1).sources.some((source) => source.page === 30 && source.text.includes("sunlight")));
  assert.match(await page.locator(".turn:last-child .receipt").textContent(), /relevant excerpts, not every page/);
  assert.ok(!requests.at(-1).history.length);
  const beforeSummary = requests.length;
  await ask("Summarize the entire document");
  await waitAnswer("too long for a complete overview");
  assert.equal(requests.length, beforeSummary, "Unsupported exhaustive tasks fail before paid inference");
  mode = "slow";
  release = null;
  await ask("A question interrupted by a new PDF");
  await waitRelease();
  await openPdf("different-document.pdf", ["A completely different lesson about music."]);
  mode = "success";
  release();
  assert.equal(await answers.count(), 0);
  await page.locator("#explain").click();
  await waitAnswer("Answer about page 1");
  assert.equal(await answers.count(), 1, "A late response cannot appear in another PDF's transcript");
  assert.equal(requests.at(-1).history.length, 0);
  assert.match(requests.at(-1).sources[0].text, /music/);
  assert.deepEqual(errors, [], "No uncaught browser exceptions");
  console.log("Browser checks passed: PDF import/rendering, transcript persistence through navigation/zoom, page/whole-PDF scope, distant-page retrieval, history follow-ups, citation navigation and validation, safe text rendering, retry/stop/navigation cancellation, new-chat/document isolation, blank pages, and honest long-document coverage. Real local backend contract; AI mocked, no API key used.");
} finally {
  await context?.close();
  server?.closeAllConnections();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  await rm(profile, { recursive: true, force: true });
}
