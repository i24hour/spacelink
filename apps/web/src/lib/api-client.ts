"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function useApi() {
  return {
    async fetcher(path: string, init?: RequestInit) {
      const token = localStorage.getItem("deadlineai_token");
      if (!token) {
        throw new Error("Sign in required");
      }
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      return res.json();
    },
  };
}
