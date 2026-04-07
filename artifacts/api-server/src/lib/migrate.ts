import { pool } from "@workspace/db";
import { logger } from "./logger.js";

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info("Running DB migrations...");

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE user_status AS ENUM ('active', 'paused', 'suspended');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id            text        PRIMARY KEY,
        email         text        NOT NULL UNIQUE,
        username      text        NOT NULL UNIQUE,
        password_hash text        NOT NULL,
        created_at    timestamp   NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                   text         PRIMARY KEY,
        account_id           text,
        name                 text         NOT NULL DEFAULT 'My Bot',
        phone                text         UNIQUE,
        session_id           text,
        status               user_status  NOT NULL DEFAULT 'active',
        is_first_connection  text         NOT NULL DEFAULT 'true',
        linked_at            timestamp,
        last_seen            timestamp,
        created_at           timestamp    NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id             text    PRIMARY KEY,
        prefix              text    NOT NULL DEFAULT '.',
        mode                text    NOT NULL DEFAULT 'public',
        anticall_msg        text    DEFAULT '📵 Calls are not allowed. Please send a message instead.',
        welcome_msg         text    DEFAULT '👋 Welcome {user} to {group}! We''re glad to have you here. 🎉',
        goodbye_msg         text    DEFAULT '👋 Goodbye {user}! We hope to see you again. 💫',
        like_emojis         text    NOT NULL DEFAULT '🎉 ✨ 💯 🩵 🔥',
        anticall            boolean NOT NULL DEFAULT false,
        antilink            boolean NOT NULL DEFAULT false,
        antilink_action     text    NOT NULL DEFAULT 'delete',
        antisticker         boolean NOT NULL DEFAULT false,
        antisticker_action  text    NOT NULL DEFAULT 'delete',
        antitag             boolean NOT NULL DEFAULT false,
        antitag_action      text    NOT NULL DEFAULT 'delete',
        antibadword         boolean NOT NULL DEFAULT false,
        antibadword_action  text    NOT NULL DEFAULT 'delete',
        antispam            boolean NOT NULL DEFAULT false,
        antispam_action     text    NOT NULL DEFAULT 'delete',
        antidelete          boolean NOT NULL DEFAULT false,
        chatbot             boolean NOT NULL DEFAULT false,
        autoread            boolean NOT NULL DEFAULT true,
        alwaysonline        boolean NOT NULL DEFAULT true,
        autoviewstatus      boolean NOT NULL DEFAULT true,
        autolikestatus      boolean NOT NULL DEFAULT true,
        autotype            boolean NOT NULL DEFAULT false,
        autotype_mode       text    NOT NULL DEFAULT 'typing',
        welcome             boolean NOT NULL DEFAULT true,
        goodbye             boolean NOT NULL DEFAULT true,
        badwords            jsonb            DEFAULT '[]'::jsonb
      );
    `);

    // bot_sessions: stores WhatsApp auth state keyed on users.session_id
    // so bots reconnect automatically after server restarts without re-pairing.
    // If the table was created with the old 'bot_id' primary key, rename it first.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'bot_sessions' AND column_name = 'bot_id'
        ) THEN
          ALTER TABLE bot_sessions RENAME COLUMN bot_id TO session_id;
        END IF;
      END;
      $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_sessions (
        session_id  text      PRIMARY KEY,
        creds       jsonb,
        keys        jsonb     NOT NULL DEFAULT '{}'::jsonb,
        updated_at  timestamp NOT NULL DEFAULT NOW()
      );
    `);

    logger.info("DB migrations complete");
  } catch (err) {
    logger.error({ err }, "DB migration failed");
    throw err;
  } finally {
    client.release();
  }
}
