(() => {
  if (window.__explainSlideCardInstalled) return;
  window.__explainSlideCardInstalled = true;

  const host = document.createElement("div");
  host.id = "explain-slide-root";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .card { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
        width: min(360px, calc(100vw - 36px)); max-height: min(450px, calc(100vh - 36px));
        display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box;
        background: #fff; color: #17212b; border: 1px solid #d9e1e8; border-radius: 14px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, .25); font: 14px/1.55 system-ui, sans-serif; }
      .card[hidden] { display: none; }
      .card.expanded { width: min(580px, calc(100vw - 36px)); max-height: calc(100vh - 36px); }
      header { display: flex; align-items: center; gap: 8px; padding: 11px 14px;
        border-bottom: 1px solid #e5eaf0; background: #f7f9fc; }
      strong { flex: 1; font-size: 13px; }
      button { border: 0; background: transparent; color: #334155; cursor: pointer;
        font: inherit; padding: 2px 6px; border-radius: 5px; }
      button:hover, button:focus-visible { background: #e4eaf2; }
      main { padding: 14px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
      .error { color: #a12424; }
    </style>
    <section class="card" role="status" aria-live="polite" hidden>
      <header><strong>Explain this slide</strong><button class="expand" title="Expand" aria-label="Expand">⤢</button><button class="close" title="Close" aria-label="Close">×</button></header>
      <main></main>
    </section>`;
  (document.documentElement || document.body).appendChild(host);
  const card = shadow.querySelector(".card");
  const body = shadow.querySelector("main");
  shadow.querySelector(".close").addEventListener("click", () => { card.hidden = true; });
  shadow.querySelector(".expand").addEventListener("click", () => {
    card.classList.toggle("expanded");
    shadow.querySelector(".expand").setAttribute("aria-label", card.classList.contains("expanded") ? "Collapse" : "Expand");
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "hide") {
      card.hidden = true;
      sendResponse({ ok: true });
    }
    if (message.type === "show") {
      body.textContent = message.state.text || "Reading the visible material…";
      body.classList.toggle("error", message.state.status === "error");
      card.hidden = false;
      sendResponse({ ok: true });
    }
  });
})();
