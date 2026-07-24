import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import authRouter from "./routes/auth";
import linksRouter from "./routes/links";
import remindersRouter from "./routes/reminders";
import usersRouter from "./routes/users";
import profileRouter from "./routes/profile";
import leaderboardRouter from "./routes/leaderboard";
import webhooksRouter from "./routes/webhooks";
import notificationsRouter from "./routes/notifications";
import telegramWebhookRouter from "./routes/telegram-webhook";

import { linkProcessorWorker } from "./queues/processor";
import { reminderDispatchWorker } from "./queues/dispatcher";
import { startCron } from "./cron/reminders";
import { validateSecretsAtStartup } from "./lib/secrets";
import { getAllowedFrontendOrigins } from "./lib/frontend-url";
import { extractWithLLM, getLlmConfigSummary } from "./lib/llm";

validateSecretsAtStartup();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
const allowedOrigins = getAllowedFrontendOrigins();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked origin: ${origin}`));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

/** LLM config probe (no secrets). Add ?ping=1 to run a tiny Bedrock/Kimi call. */
app.get("/health/llm", async (req, res) => {
  const summary = getLlmConfigSummary();
  if (req.query.ping !== "1") {
    res.json({ ok: summary.apiKeyConfigured, ...summary });
    return;
  }

  try {
    const result = await extractWithLLM(
      'Return JSON only: {"ok":true,"provider":"bedrock","model_check":"kimi-k2.5"}'
    );
    res.json({
      ok: Boolean(result && (result as { ok?: unknown }).ok !== false),
      ...summary,
      ping: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, ...summary, error: message });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/webhooks/telegram", telegramWebhookRouter);
app.use("/api/links", linksRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/notifications", notificationsRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`DeadlineAI API running on http://localhost:${PORT}`);
  startCron();
});

// Keep workers alive
process.on("SIGTERM", async () => {
  await linkProcessorWorker.close();
  await reminderDispatchWorker.close();
  process.exit(0);
});
