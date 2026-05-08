chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "storeToken") {
    chrome.storage.local.set({ token: message.token }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.action === "getToken") {
    chrome.storage.local.get("token", (result) => {
      sendResponse({ token: result.token || null });
    });
    return true;
  }

  if (message.action === "clearToken") {
    chrome.storage.local.remove("token", () => sendResponse({ ok: true }));
    return true;
  }
});
