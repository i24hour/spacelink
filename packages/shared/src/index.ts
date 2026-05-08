export interface LinkPayload {
  url: string;
  title: string;
  rawContent: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedDeadline {
  title: string;
  deadline: string; // ISO
  timezone: string;
  category: string;
  urgencyScore: number; // 1-10
  confidenceScore: number; // 0-1
  rollingApplication: boolean;
  estimatedCompletionMinutes: number;
}

export interface SaveLinkRequest {
  url: string;
  title: string;
  rawContent: string;
  metadata?: Record<string, unknown>;
  manualDeadline?: string;
}

export interface ReminderChannel {
  type: "email" | "whatsapp" | "telegram";
  enabled: boolean;
}
