const API_URL = "http://127.0.0.1:8787/explain";
let current = { requestId: 0, status: "idle", text: "", tabId: null };
let fallbackWindowId = null;

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-pdf") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("viewer/viewer.html") });
    return;
  }
  if (command !== "explain-slide") return;
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url === chrome.runtime.getURL("fallback.html") && current.tabId !== null) {
    tab = await chrome.tabs.get(current.tabId).catch(() => null);
  }
  if (tab) explainTarget(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "explain-active-tab" && sender.url === chrome.runtime.getURL("popup.html")) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) explainTarget(tab);
    });
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "get-state") {
    sendResponse(current);
    return;
  }
  if (message.type === "close-fallback") {
    if (fallbackWindowId !== null) chrome.windows.remove(fallbackWindowId).catch(() => {});
    fallbackWindowId = null;
    sendResponse({ ok: true });
  }
});

async function explainTarget(tab) {
  if (tab.url === chrome.runtime.getURL("viewer/viewer.html")) {
    await chrome.tabs.sendMessage(tab.id, { type: "explain-pdf-page" }).catch(() => {});
    return;
  }
  await explain(tab);
}

async function sendToCard(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

async function ensureCard(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["card.js"] });
    return true;
  } catch {
    return false;
  }
}

async function showFallback() {
  if (fallbackWindowId !== null) {
    try {
      await chrome.windows.update(fallbackWindowId, { focused: true });
      return;
    } catch {
      fallbackWindowId = null;
    }
  }
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL("fallback.html"),
    type: "popup",
    width: 420,
    height: 500,
    focused: true
  });
  fallbackWindowId = window.id;
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === fallbackWindowId) fallbackWindowId = null;
});

async function publish(tabId, canInject, state) {
  current = state;
  if (canInject && await sendToCard(tabId, { type: "show", state })) return;
  await showFallback();
  chrome.runtime.sendMessage({ type: "state-changed", state }).catch(() => {});
}

async function explain(tab) {
  const previousTabId = current.tabId;
  const requestId = current.requestId + 1;
  current = { requestId, status: "loading", text: "", tabId: tab.id };
  if (typeof tab.id !== "number" || typeof tab.windowId !== "number") return;
  if (previousTabId !== null && previousTabId !== tab.id) {
    await sendToCard(previousTabId, { type: "hide" });
  }

  const canInject = await ensureCard(tab.id);
  if (canInject && fallbackWindowId !== null) {
    await chrome.windows.remove(fallbackWindowId).catch(() => {});
    fallbackWindowId = null;
  }
  if (canInject) {
    await sendToCard(tab.id, { type: "hide" });
    // Give Chrome one paint frame before capture so an old card cannot appear in it.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  let screenshot;
  try {
    screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
  } catch {
    await publish(tab.id, canInject, {
      requestId, status: "error", text: "Chrome could not capture this tab. Open a normal web page or PDF tab and try again.", tabId: tab.id
    });
    return;
  }

  if (requestId !== current.requestId) return;
  await publish(tab.id, canInject, { requestId, status: "loading", text: "Reading the visible material…", tabId: tab.id });

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: screenshot })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Backend error (${response.status})`);
    if (requestId !== current.requestId) return;
    await publish(tab.id, canInject, { requestId, status: "done", text: result.explanation, tabId: tab.id });
  } catch (error) {
    if (requestId !== current.requestId) return;
    await publish(tab.id, canInject, {
      requestId, status: "error", text: error.message || "Could not explain this image.", tabId: tab.id
    });
  }
}
