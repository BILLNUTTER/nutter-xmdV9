import app from "./app";
import { logger } from "./lib/logger";
import { restoreAllSessions, cleanupExpiredMessages } from "./bot/manager.js";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — server continues");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — server continues");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const publicDir = join(process.cwd(), "public");
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });

const sessionsDir = join(process.cwd(), "sessions");
if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "NUTTER-XMD API Server listening");

  cleanupExpiredMessages();

  try {
    await restoreAllSessions();
    logger.info("Bot sessions restored");
  } catch (err) {
    logger.error({ err }, "Failed to restore sessions");
  }
});
