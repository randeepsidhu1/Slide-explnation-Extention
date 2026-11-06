document.getElementById("screenshot").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "explain-active-tab" });
  window.close();
});
document.getElementById("pdf").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer/viewer.html") });
  window.close();
});
