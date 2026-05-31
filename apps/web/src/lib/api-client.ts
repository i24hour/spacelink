"use client";

import { useCallback, useMemo } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class FetchTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchWithTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  timeoutMessage = "Request timed out"
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new FetchTimeoutError(timeoutMessage)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function authHeaders(required: boolean): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("deadlineai_token") : null;
  if (required && !token) {
    throw new Error("Sign in required");
  }
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json",
  };
}

export function useApi() {
  const fetcher = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...authHeaders(true),
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || res.statusText, res.status);
    }
    return res.json();
  }, []);

  const publicFetcher = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...authHeaders(false),
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || res.statusText, res.status);
    }
    return res.json();
  }, []);

  return useMemo(() => ({ fetcher, publicFetcher }), [fetcher, publicFetcher]);
}
