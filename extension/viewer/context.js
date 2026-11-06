export const MAX_CONTEXT_CHARS = 64000;
export const MAX_HISTORY_CHARS = 24000;
const STOP_WORDS = new Set("a an and are as at be been by can could do does for from had has have how i in is it its me my of on or our please should that the their them there these they this those to was we were what when where which who why will with would you your explain example give about".split(" "));

function terms(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter((word) => !STOP_WORDS.has(word)).map((word) => word.length > 4 ? word.replace(/(?:ing|ed|es|s)$/, "") : word);
}

export function buildIndex(pages) {
  const chunks = [];
  const frequencies = new Map();
  for (const page of pages) {
    if (page.status !== "text") continue;
    for (let offset = 0, number = 1; offset < page.text.length; offset += 1800, number++) {
      const text = page.text.slice(offset, offset + 2000);
      const counts = new Map();
      for (const word of terms(text)) counts.set(word, (counts.get(word) || 0) + 1);
      for (const word of counts.keys()) frequencies.set(word, (frequencies.get(word) || 0) + 1);
      chunks.push({ id: `p${page.pageNumber}_c${number}`, page: page.pageNumber, text, counts, length: [...counts.values()].reduce((a, b) => a + b, 0) });
      if (offset + 2000 >= page.text.length) break;
    }
  }
  return { chunks, frequencies, averageLength: chunks.reduce((sum, chunk) => sum + chunk.length, 0) / (chunks.length || 1), pages };
}

export function selectHistory(turns) {
  // Only complete pairs enter a future prompt. A cancelled/failed turn stays in the UI.
  const complete = turns.filter((turn) => turn.status === "complete");
  const selected = [];
  let characters = 0;
  for (const turn of complete.slice().reverse()) {
    if (selected.length >= 12 || characters + turn.question.length + turn.answer.length > MAX_HISTORY_CHARS) break;
    selected.unshift(turn);
    characters += turn.question.length + turn.answer.length;
  }
  return {
    messages: selected.flatMap((turn) => [{ role: "user", text: turn.question }, { role: "assistant", text: turn.answer }]),
    omittedTurns: complete.length - selected.length
  };
}

export function prepareContext({ index, mode, question, currentPage, history = [], previousSources = [] }) {
  const all = index.chunks;
  let selected;
  let strategy;
  if (mode === "page") {
    selected = all.filter((chunk) => chunk.page === currentPage);
    if (selected.reduce((sum, chunk) => sum + chunk.text.length, 0) > MAX_CONTEXT_CHARS) {
      throw new Error("This page has too much text for one answer. Try asking about a smaller document.");
    }
    strategy = "current-page";
  } else if (all.length <= 509 && all.reduce((sum, chunk) => sum + chunk.text.length, 0) <= MAX_CONTEXT_CHARS) {
    selected = all;
    strategy = "all-text";
  } else {
    // Do not silently answer exhaustive requests from a handful of retrieved excerpts.
    if (/\b(summari[sz]e|summary|overview|every\s+(?:page|definition|term|concept|topic|section)|all\s+(?:the\s+)?(?:definitions|pages|concepts|topics)|complete\s+(?:list|document))\b/i.test(question)) {
      throw new Error("This PDF is too long for a complete overview in one request. Ask a specific question to search across it, or use Current page. Full-document batch summaries are not available yet.");
    }
    const query = terms([question, ...history.filter((message) => message.role === "user").slice(-3).map((message) => message.text)].join(" "));
    const explicitPages = new Set([...question.matchAll(/\b(?:page|p\.)\s*(\d+)\b/gi)].map((match) => Number(match[1])));
    const previousPages = new Set(previousSources.map((source) => source.page));
    const ranked = all.map((chunk) => {
      let score = 0;
      for (const word of new Set(query)) {
        const frequency = chunk.counts.get(word) || 0;
        if (!frequency) continue;
        const idf = Math.log(1 + (all.length - (index.frequencies.get(word) || 0) + 0.5) / ((index.frequencies.get(word) || 0) + 0.5));
        score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * chunk.length / (index.averageLength || 1)));
      }
      if (explicitPages.has(chunk.page)) score += 100;
      if (previousPages.has(chunk.page)) score += 0.25;
      if (chunk.page === currentPage) score += 0.1;
      return { chunk, score };
    }).sort((a, b) => b.score - a.score || a.chunk.page - b.chunk.page);
    selected = ranked.filter((entry) => entry.score > 0).slice(0, 20).map((entry) => entry.chunk);
    strategy = "retrieved-excerpts";
  }
  // Include the current image and up to two other relevant page images for diagrams.
  const explicitImagePages = [...question.matchAll(/\b(?:page|p\.)\s*(\d+)\b/gi)].map((match) => Number(match[1]))
    .filter((number) => index.pages.some((page) => page.pageNumber === number));
  const imageTerms = new Set(terms([question, ...history.filter((message) => message.role === "user").slice(-1).map((message) => message.text)].join(" ")));
  const relevantImages = selected.map((chunk) => ({ page: chunk.page, score: terms(chunk.text).filter((word) => imageTerms.has(word)).length }))
    .sort((a, b) => b.score - a.score).map((entry) => entry.page);
  const imagePages = mode === "page" ? [currentPage] : [...new Set([currentPage, ...explicitImagePages, ...relevantImages])].slice(0, 3);
  const sources = selected.map(({ id, page, text }) => ({ id, page, text }));
  for (const page of imagePages) sources.push({ id: `p${page}_image`, page, text: "" });
  const pagesUsed = [...new Set(sources.map((source) => source.page))].sort((a, b) => a - b);
  const unreadable = index.pages.filter((page) => page.status !== "text").map((page) => page.pageNumber);
  return {
    sources, imagePages,
    receipt: {
      mode, strategy, pages: pagesUsed, imagePages,
      searchablePages: index.pages.length - unreadable.length,
      totalPages: index.pages.length, unreadablePages: unreadable,
      note: strategy === "retrieved-excerpts" ? "Searched the document’s extracted text; sent relevant excerpts, not every page." :
        mode === "page" ? "Only the selected page’s text and image were supplied as document evidence." : "All extracted text was supplied. Only the listed image pages were supplied visually."
    }
  };
}

export function citationParts(text, sources) {
  const known = new Map(sources.map((source) => [source.id, source]));
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(/\[(p\d+_(?:c\d+|image))\]/g)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    const source = known.get(match[1]);
    parts.push(source ? { source } : { text: "[source unavailable]" });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
