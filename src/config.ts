import dotenv from "dotenv";

dotenv.config();

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(env("PORT", "4000"), 10),

  invidious: {
    instance: env("INVIDIOUS_INSTANCE", "https://inv.nadeko.net").replace(/\/+$/, ""),
    region: env("INVIDIOUS_REGION", "US"),
  },

  lavalink: {
    host: env("LAVALINK_HOST", "localhost"),
    port: parseInt(env("LAVALINK_PORT", "2333"), 10),
    password: env("LAVALINK_PASSWORD", "youshallnotpass"),
    secure: env("LAVALINK_SECURE", "false") === "true",
    clientName: env("CLIENT_NAME", "invidious-music-backend/1.0.0"),
    // Lavalink v4 requires the User-Id header to be a numeric (snowflake-style) value.
    userId: env("CLIENT_USER_ID", "170939974227541168"),
  },
};
