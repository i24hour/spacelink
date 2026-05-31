import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load dotenv first
dotenv.config({ path: path.join(__dirname, "../apps/api/.env") });

// Append pgbouncer=true to disable prepared statements for Supabase pooler
if (process.env.DATABASE_URL) {
  // Redact password for logs
  const redacted = process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@");
  console.log("Original URL (redacted):", redacted);
  
  if (!process.env.DATABASE_URL.includes("pgbouncer")) {
    const separator = process.env.DATABASE_URL.includes("?") ? "&" : "?";
    process.env.DATABASE_URL += `${separator}pgbouncer=true`;
  }
  
  const redactedFinal = process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@");
  console.log("Final URL (redacted):", redactedFinal);
}

async function main() {
  const { PrismaClient } = await import("../packages/db/node_modules/@prisma/client");
  const prisma = new PrismaClient();

  let logStr = "";
  
  const users = await prisma.user.findMany();
  logStr += `\n--- USERS (${users.length}) ---\n`;
  for (const u of users) {
    logStr += `ID: ${u.id}, Email: ${u.email}, TelegramId: ${u.telegramId}, TZ: ${u.timezone}, Preferred: ${u.preferredChannels}\n`;
  }

  const links = await prisma.savedLink.findMany();
  logStr += `\n--- SAVED LINKS (${links.length}) ---\n`;
  for (const l of links) {
    logStr += `ID: ${l.id}, Title: ${l.title}, URL: ${l.url}, Status: ${l.status}, Deadline: ${l.extractedDeadline}\n`;
  }

  const logs = await prisma.notificationLog.findMany({
    take: 20,
    orderBy: { sentAt: "desc" }
  });
  logStr += `\n--- NOTIFICATION LOGS (last 20) ---\n`;
  for (const log of logs) {
    logStr += `ID: ${log.id}, ReminderID: ${log.reminderId}, Status: ${log.deliveryStatus}, SentAt: ${log.sentAt}, Response: ${JSON.stringify(log.responseData)}\n`;
  }

  fs.writeFileSync(path.join(__dirname, "db_output.txt"), logStr, "utf8");
  console.log("Successfully wrote db_output.txt");
  
  await prisma.$disconnect();
}

main().catch(console.error);
