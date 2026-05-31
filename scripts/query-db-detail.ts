import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load dotenv first
dotenv.config({ path: path.join(__dirname, "../apps/api/.env") });

// Append pgbouncer=true to disable prepared statements for Supabase pooler
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("pgbouncer")) {
  const separator = process.env.DATABASE_URL.includes("?") ? "&" : "?";
  process.env.DATABASE_URL += `${separator}pgbouncer=true`;
}

async function main() {
  const { PrismaClient } = await import("../packages/db/node_modules/@prisma/client");
  const prisma = new PrismaClient();

  const links = await prisma.savedLink.findMany({
    orderBy: { createdAt: "desc" },
    take: 3
  });
  
  let logStr = "";
  for (const l of links) {
    logStr += `=========================================\n`;
    logStr += `ID: ${l.id}\n`;
    logStr += `Title: ${l.title}\n`;
    logStr += `URL: ${l.url}\n`;
    logStr += `Status: ${l.status}\n`;
    logStr += `Deadline: ${l.extractedDeadline}\n`;
    logStr += `Urgency Score: ${l.urgencyScore}\n`;
    logStr += `Confidence Score: ${l.confidenceScore}\n`;
    logStr += `Raw Content Length: ${l.rawContent?.length || 0}\n`;
    logStr += `Raw Content Preview: ${l.rawContent ? l.rawContent.slice(0, 1000) : "null"}\n`;
    logStr += `=========================================\n\n`;
  }

  fs.writeFileSync(path.join(__dirname, "db_links_detail.txt"), logStr, "utf8");
  console.log("Successfully wrote db_links_detail.txt");
  
  await prisma.$disconnect();
}

main().catch(console.error);
