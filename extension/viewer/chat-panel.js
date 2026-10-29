import { citationParts, selectHistory } from "./context.js";

const $ = (id) => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pageList(pages) {
  if (pages.length <= 12) return pages.join(", ");
  return `${pages.slice(0, 8).join(", ")} … (${pages.length} pages; expand the source list below)`;
}

export function createChatPanel({ buildRequest, navigate }) {
  let turns = [];
  let pending = null;
  let availability = { ready: false, indexed: false };

  function controls() {
    const ready = availability.ready && !pending;
    $("explain").disabled = !ready;
    $("question").disabled = !availability.ready;
    $("send").disabled = !ready || ($("scope").value === "document" && !availability.indexed);
    $("whole-document").disabled = !availability.indexed;
    $("stop").hidden = !pending;
    $("new-chat").disabled = !turns.length;
    document.querySelectorAll(".follow-up").forEach((button) => { button.disabled = !ready || !turns.some((turn) => turn.status === "complete"); });
  }

  function render() {
    const transcript = $("conversation");
    transcript.replaceChildren();
    if (!turns.length) transcript.append(element("p", "muted chat-empty", "Ask about an idea, connect two pages, or start with an explanation. Your conversation stays here as you navigate."));
    for (const turn of turns) {
      const article = element("article", "turn");
      article.append(element("div", "speaker", "You"), element("p", "user-question", turn.question));
      article.append(element("div", "speaker", "Study assistant"));
      const content = element("div", `assistant-answer${["failed", "cancelled"].includes(turn.status) ? " error" : ""}`);
      if (turn.status === "complete") {
        for (const part of citationParts(turn.answer, turn.sources)) {
          if (part.source) {
            const button = element("button", "citation", `p. ${part.source.page}`);
            button.type = "button";
            button.title = part.source.text ? part.source.text.slice(0, 300) : `Rendered image of page ${part.source.page}`;
            button.setAttribute("aria-label", `Go to PDF page ${part.source.page}`);
            button.addEventListener("click", () => navigate(part.source.page));
            content.append(button);
          } else content.append(document.createTextNode(part.text));
        }
      } else content.textContent = turn.answer;
      article.append(content);
      if (turn.warning) article.append(element("p", "citation-warning small", turn.warning));
      if (turn.receipt) {
        const details = element("details", "receipt");
        details.append(element("summary", "", `${turn.mode === "page" ? `Current page ${turn.page}` : "Whole PDF"} · Pages used: ${pageList(turn.receipt.pages)}`));
        details.append(element("p", "small", turn.receipt.note));
        details.append(element("p", "small", `Searchable text: ${turn.receipt.searchablePages} of ${turn.receipt.totalPages} pages. Page images supplied: ${turn.receipt.imagePages.join(", ")}.`));
        if (turn.receipt.unreadablePages.length && turn.mode === "document") {
          details.append(element("p", "small citation-warning", `${turn.receipt.unreadablePages.length} pages have no readable extracted text. Their contents cannot be searched; only the listed image pages were supplied visually.`));
        }
        details.append(element("p", "small", `Earlier exchanges included: ${turn.historyTurns}. Earlier complete exchanges omitted: ${turn.omittedTurns}. ${turn.provider || "Gemini"}${turn.model ? ` · ${turn.model}` : ""}.`));
        const pages = element("div", "source-pages");
        for (const page of turn.receipt.pages) {
          const button = element("button", "source-page", `Page ${page}`);
          button.type = "button";
          button.addEventListener("click", () => navigate(page));
          pages.append(button);
        }
        details.append(pages);
        article.append(details);
      }
      if (turn.status === "failed") {
        const retry = element("button", "retry", "Retry question");
        retry.type = "button";
        retry.disabled = Boolean(pending);
        retry.addEventListener("click", () => send(turn.question, turn.mode, turn.page));
        article.append(retry);
      }
      transcript.append(article);
    }
    transcript.scrollTop = transcript.scrollHeight;
    controls();
  }

  function cancel(message = "Request stopped. You can ask again.") {
    if (!pending) return;
    const job = pending;
    pending = null;
    job.controller.abort();
    job.turn.status = "cancelled";
    job.turn.answer = message;
    render();
    $("chat-status").textContent = message;
  }

  async function send(question, mode = $("scope").value, page = availability.page) {
    question = question.trim();
    if (!question || pending || !availability.ready) return;
    if (question.length > 4000) { $("chat-status").textContent = "Keep the question under 4000 characters."; return; }
    const history = selectHistory(turns);
    const previousSources = turns.filter((turn) => turn.status === "complete").at(-1)?.sources || [];
    const turn = { question, mode, page, status: "preparing", answer: "Finding the relevant material…", sources: [], historyTurns: history.messages.length / 2, omittedTurns: history.omittedTurns };
    const job = { controller: new AbortController(), turn };
    pending = job;
    turns.push(turn);
    $("question").value = "";
    render();
    const timeout = setTimeout(() => job.controller.abort("timeout"), 70000);
    try {
      const context = await buildRequest({ question, mode, page, history: history.messages, previousSources, signal: job.controller.signal });
      if (pending !== job) return;
      job.controller.signal.throwIfAborted();
      turn.sources = context.sources;
      turn.receipt = context.receipt;
      turn.status = "loading";
      turn.answer = "Reading the supplied pages…";
      render();
      const response = await fetch("http://127.0.0.1:8787/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context.payload), signal: job.controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Backend error (${response.status}).`);
      if (typeof result.answer !== "string" || !result.answer.trim()) throw new Error("The backend returned an empty answer.");
      if (pending !== job) return;
      turn.status = "complete";
      turn.answer = result.answer;
      turn.warning = result.citationWarning || "";
      turn.provider = result.provider;
      turn.model = result.model;
      $("chat-status").textContent = "Answer ready. Page references open the source PDF page.";
    } catch (error) {
      if (pending !== job) return;
      turn.status = "failed";
      turn.answer = job.controller.signal.aborted ? "The request timed out. Retry when ready." :
        error instanceof TypeError && error.message === "Failed to fetch" ? "Could not reach your local backend. Start it with npm start inside backend/ and retry." : error.message || "Could not answer this question.";
      $("chat-status").textContent = turn.answer;
    } finally {
      clearTimeout(timeout);
      if (pending === job) {
        pending = null;
        render();
      }
    }
  }

  $("chat-form").addEventListener("submit", (event) => { event.preventDefault(); send($("question").value); });
  $("question").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send($("question").value); }
  });
  $("scope").addEventListener("change", controls);
  $("stop").addEventListener("click", () => cancel());
  $("explain").addEventListener("click", () => send("Explain the main idea of this page. Walk through unfamiliar terms, equations, and diagrams, with a short example if useful.", "page"));
  for (const button of document.querySelectorAll(".follow-up")) button.addEventListener("click", () => send(button.dataset.question));
  function reset() {
    cancel();
    turns = [];
    $("scope").value = "page";
    $("question").value = "";
    $("chat-status").textContent = "";
    render();
  }
  $("new-chat").addEventListener("click", reset);
  render();
  return {
    cancel, reset,
    explain: () => send("Explain the main idea of this page. Walk through unfamiliar terms, equations, and diagrams, with a short example if useful.", "page"),
    setAvailability(value) { availability = value; controls(); }
  };
}
