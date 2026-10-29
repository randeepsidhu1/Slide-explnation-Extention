const imagePattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export function validateChat(payload) {
  const fail = (message) => { throw new TypeError(message); };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("Expected a PDF chat request.");
  const { question, mode, totalPages, currentPage, sources, images, history } = payload;
  if (typeof question !== "string" || !question.trim() || question.length > 4000) fail("Enter a question of 1–4000 characters.");
  if (!["page", "document"].includes(mode)) fail("Choose current-page or whole-document context.");
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 500 || !Number.isInteger(currentPage) || currentPage < 1 || currentPage > totalPages) fail("Invalid PDF page range.");
  if (!Array.isArray(sources) || !sources.length || sources.length > 512) fail("Expected bounded PDF sources.");
  const ids = new Set();
  let textLength = 0;
  const cleanSources = sources.map((source) => {
    if (!source || typeof source !== "object" || !Number.isInteger(source.page) || source.page < 1 || source.page > totalPages ||
      typeof source.id !== "string" || !new RegExp(`^p${source.page}_(?:c[1-9][0-9]*|image)$`).test(source.id) || ids.has(source.id) ||
      typeof source.text !== "string" || (mode === "page" && source.page !== currentPage)) fail("Invalid or duplicate PDF source.");
    ids.add(source.id);
    textLength += source.text.length;
    return { id: source.id, page: source.page, text: source.text };
  });
  if (textLength > 64000) fail("PDF context exceeds the 64000-character budget.");
  if (!Array.isArray(images) || images.length > 3) fail("Expected at most three PDF page images.");
  const imageIds = new Set();
  const cleanImages = images.map((image) => {
    if (!image || !ids.has(image.sourceId) || !image.sourceId.endsWith("_image") || imageIds.has(image.sourceId) ||
      typeof image.data !== "string" || image.data.length > 3 * 1024 * 1024 || !imagePattern.test(image.data)) fail("Invalid PDF page image.");
    imageIds.add(image.sourceId);
    return { sourceId: image.sourceId, data: image.data };
  });
  if (cleanSources.some((source) => source.id.endsWith("_image") ? !imageIds.has(source.id) || source.text !== "" : !source.text.trim())) fail("PDF sources must contain text or a supplied page image.");
  if (!Array.isArray(history) || history.length > 24 || history.length % 2) fail("Expected at most twelve complete conversation turns.");
  let historyLength = 0;
  const cleanHistory = history.map((message, index) => {
    if (!message || message.role !== (index % 2 ? "assistant" : "user") || typeof message.text !== "string" || !message.text.trim()) fail("Invalid conversation history.");
    historyLength += message.text.length;
    return { role: message.role, text: message.text };
  });
  if (historyLength > 24000) fail("Conversation context exceeds the 24000-character budget.");
  // Return a whitelist, not arbitrary client-supplied generation settings or instructions.
  return { question: question.trim(), mode, totalPages, currentPage, sources: cleanSources, images: cleanImages, history: cleanHistory };
}

export function resolveCitations(answer, sources) {
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Gemini returned no answer. Try again.");
  const known = new Map(sources.map((source) => [source.id, source]));
  const citations = new Map();
  let invalid = false;
  const text = answer.replace(/\[(p\d+_(?:c\d+|image))\]/g, (marker, id) => {
    const source = known.get(id);
    if (!source) { invalid = true; return "[source unavailable]"; }
    citations.set(id, { id, page: source.page });
    return marker;
  });
  return {
    answer: text, citations: [...citations.values()],
    citationWarning: invalid ? "An unsupported source reference was removed. Check the supplied pages before relying on this answer." :
      citations.size ? "" : "No page references were returned. Treat this answer as uncited and check it against the document."
  };
}
