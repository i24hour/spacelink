import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis";
import { processExtraction } from "../services/extraction";

export const linkProcessorQueue = new Queue("link-processor", {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
});

export const linkProcessorWorker = new Worker(
  "link-processor",
  async (job) => {
    const { savedLinkId } = job.data as { savedLinkId: string };
    await processExtraction(savedLinkId);
    return { ok: true };
  },
  { connection: redis }
);

linkProcessorWorker.on("completed", (job) => {
  console.log(`Extraction completed for link ${job.data.savedLinkId}`);
});

linkProcessorWorker.on("failed", (job, err) => {
  console.error(`Extraction failed for link ${job?.data?.savedLinkId}:`, err);
});
