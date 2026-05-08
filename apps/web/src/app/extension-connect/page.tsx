"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function ExtensionConnectPage() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState("Authenticating...");

  useEffect(() => {
    let cancelled = false;
    getToken()
      .then((token) => {
        if (cancelled) return;
        if (token) {
          window.postMessage({ type: "DEADLINEAI_TOKEN", token }, "*");
          setStatus("Extension connected. You can close this tab.");
          setTimeout(() => window.close(), 800);
        } else {
          setStatus("Unable to get token. Please sign in.");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("Something went wrong.");
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <div className="flex min-h-screen items-center justify-center text-center">
      <div>
        <h1 className="text-xl font-bold">DeadlineAI Extension</h1>
        <p className="mt-2 text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
