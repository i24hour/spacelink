import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDistanceToNow(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (diff < 0) return `${days}d ago`;
  if (days > 0) return `${days}d left`;
  return `${hours}h left`;
}

export type DeadlineUrgency = "passed" | "critical" | "soon" | "upcoming" | "none";

export function getDeadlineUrgency(deadline: string | Date | null): DeadlineUrgency {
  if (!deadline) return "none";
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff < 0) return "passed";
  const days = diff / (1000 * 60 * 60 * 24);
  if (days <= 1) return "critical";
  if (days <= 7) return "soon";
  return "upcoming";
}

export function formatDeadlineDate(deadline: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(deadline));
}
