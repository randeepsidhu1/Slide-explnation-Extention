import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex, prepareContext, selectHistory, citationParts, MAX_CONTEXT_CHARS } from "../extension/viewer/context.js";

const pages = [
  { pageNumber: 1, text: "Fractions describe parts of a whole.", status: "text" },
  { pageNumber: 2, text: "Gravity attracts objects with mass.", status: "text" },
  { pageNumber: 3, text: "Photosynthesis turns light into chemical energy.", status: "text" }
];

test("current-page context excludes other pages even when previous history mentions them", () => {
  const context = prepareContext({ index: buildIndex(pages), mode: "page", question: "Why?", currentPage: 2, history: [{ role: "user", text: "Photosynthesis?" }] });
  assert.deepEqual(context.receipt.pages, [2]);
  assert.ok(context.sources.every((source) => source.page === 2));
});

test("short PDFs include all extracted text with stable page source IDs", () => {
  const context = prepareContext({ index: buildIndex(pages), mode: "document", question: "Connect these ideas", currentPage: 1 });
  assert.equal(context.receipt.strategy, "all-text");
  assert.deepEqual(context.receipt.pages, [1, 2, 3]);
  assert.match(context.sources.find((source) => source.id === "p3_c1").text, /Photosynthesis/);
});

const large = Array.from({ length: 100 }, (_, i) => ({ pageNumber: i + 1, status: "text", text: i === 96 ? "Photosynthesis transforms sunlight into chemical energy. ".repeat(100) : "Unrelated background material about fractions and numbers. ".repeat(100) }));

test("large-PDF search finds a fact on a distant page within a bounded payload", () => {
  const context = prepareContext({ index: buildIndex(large), mode: "document", question: "How does photosynthesis use sunlight?", currentPage: 1 });
  assert.equal(context.receipt.strategy, "retrieved-excerpts");
  assert.ok(context.sources.some((source) => source.page === 97 && source.text.includes("sunlight")));
  assert.ok(context.sources.reduce((sum, source) => sum + source.text.length, 0) <= MAX_CONTEXT_CHARS);
  assert.ok(context.imagePages.length <= 3);
  assert.ok(context.receipt.pages.length < 100);
});

test("follow-up retrieval incorporates earlier questions instead of searching only 'why'", () => {
  const context = prepareContext({ index: buildIndex(large), mode: "document", question: "Why?", currentPage: 1, history: [{ role: "user", text: "How does photosynthesis use sunlight?" }] });
  assert.ok(context.sources.some((source) => source.page === 97));
});

test("explicit page references retrieve that page in a long PDF", () => {
  const context = prepareContext({ index: buildIndex(large), mode: "document", question: "Explain page 88", currentPage: 1 });
  assert.ok(context.sources.some((source) => source.page === 88));
});

test("requested and relevant diagrams receive image slots even in an all-text PDF", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ pageNumber: i + 1, status: "text", text: i === 8 ? "Photosynthesis diagram shows sunlight." : "Unrelated definitions." }));
  const context = prepareContext({ index: buildIndex(many), mode: "document", question: "Explain the photosynthesis diagram on page 9", currentPage: 1 });
  assert.equal(context.receipt.strategy, "all-text");
  assert.ok(context.imagePages.includes(9));
});

test("exhaustive requests do not silently use a partial selection", () => {
  assert.throws(() => prepareContext({ index: buildIndex(large), mode: "document", question: "Summarize this document", currentPage: 1 }), /too long for a complete overview/);
});

test("receipts identify text coverage gaps and image-only sources", () => {
  const context = prepareContext({ index: buildIndex([{ pageNumber: 1, text: "", status: "no-text" }, pages[1]]), mode: "document", question: "What is this?", currentPage: 1 });
  assert.deepEqual(context.receipt.unreadablePages, [1]);
  assert.equal(context.receipt.searchablePages, 1);
  assert.ok(context.sources.some((source) => source.id === "p1_image"));
});

test("history excludes failed/cancelled turns and keeps complete pairs within budget", () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({ question: `Question ${i}`, answer: "Answer".repeat(500), status: "complete" }));
  turns.push({ question: "Never use this failed question", answer: "Error", status: "failed" });
  const result = selectHistory(turns);
  assert.ok(result.messages.length % 2 === 0 && result.messages.length <= 24);
  assert.ok(result.messages.reduce((sum, message) => sum + message.text.length, 0) <= 24000);
  assert.ok(result.omittedTurns > 0);
  assert.doesNotMatch(JSON.stringify(result.messages), /Never use this/);
});

test("citation mapping links only known source IDs and treats HTML as plain text", () => {
  const parts = citationParts("<img src=x onerror=bad()> [p3_c1] [p999_c1]", [{ id: "p3_c1", page: 3, text: "Evidence" }]);
  assert.equal(parts.filter((part) => part.source).length, 1);
  assert.match(parts[0].text, /<img/);
  assert.ok(parts.some((part) => part.text === "[source unavailable]"));
});
