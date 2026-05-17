"use client";

import { useEffect, useState } from "react";

export default function ExtensionConnectPage() {
  const [status, setStatus] = useState("Checking session...");

  useEffect(() => {
    const token = localStorage.getItem("deadlineai_token");
    if (token) {
      window.postMessage({ type: "DEADLINEAI_TOKEN", token }, "*");
      setStatus("Extension connected. You can close this tab.");
      setTimeout(() => window.close(), 800);
      return;
    }
    window.location.href = "/auth";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center text-center">
      <div>
        <h1 className="text-xl font-bold">DeadlineAI Extension</h1>
        <p className="mt-2 text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
