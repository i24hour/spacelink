if (typeof window !== "undefined") {
  if (window.location.pathname === "/extension-connect") {
    window.addEventListener(
      "message",
      (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.source !== window) return;
        if (event.data?.type === "DEADLINEAI_TOKEN") {
          chrome.runtime.sendMessage({
            action: "storeToken",
            token: event.data.token,
          });
        }
      },
      false
    );
  }
}

export {};
