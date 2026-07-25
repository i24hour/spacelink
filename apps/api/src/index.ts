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
import mobileMonitoringRouter from "./routes/mobile-monitoring";

import { linkProcessorWorker } from "./queues/processor";
import { reminderDispatchWorker } from "./queues/dispatcher";
import { startCron } from "./cron/reminders";
import { validateSecretsAtStartup } from "./lib/secrets";
import { getAllowedFrontendOrigins } from "./lib/frontend-url";

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

app.use("/api/auth", authRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/webhooks/telegram", telegramWebhookRouter);
app.use("/api/links", linksRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/mobile", mobileMonitoringRouter);

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
