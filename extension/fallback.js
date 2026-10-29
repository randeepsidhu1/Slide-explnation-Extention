const content = document.getElementById("content");
function render(state) {
  content.textContent = state.text || "Reading the visible material…";
  content.classList.toggle("error", state.status === "error");
}
chrome.runtime.sendMessage({ type: "get-state" }).then(render).catch(() => {});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "state-changed") render(message.state);
});
document.getElementById("close").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "close-fallback" }).catch(() => window.close());
});
