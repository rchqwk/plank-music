import "dotenv/config";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID || undefined,
  playerBotToken: required("PLAYER_BOT_TOKEN"),
  backendUrl: (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, ""),
  playerIdPrefix: process.env.PLAYER_ID_PREFIX || "",
};

export const playerIdFor = (guildId: string): string => `${config.playerIdPrefix}${guildId}`;
