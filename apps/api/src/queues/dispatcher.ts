import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis";
import { dispatchDueReminder } from "../services/reminder-dispatch";

export const reminderDispatchQueue = new Queue("reminder-dispatch", {
  connection: redis,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5000 } },
});

export const reminderDispatchWorker = new Worker(
  "reminder-dispatch",
  async (job) => {
    const { reminderId } = job.data as { reminderId: string };
    return dispatchDueReminder(reminderId);
  },
  { connection: redis }
);

reminderDispatchWorker.on("completed", (job, result) => {
  console.log(`Reminder ${job.data.reminderId} dispatched:`, result);
});

reminderDispatchWorker.on("failed", (job, err) => {
  console.error(`Reminder ${job?.data?.reminderId} failed:`, err);
});
