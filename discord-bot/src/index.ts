import { REST, Routes, Client, GatewayIntentBits, type ChatInputCommandInteraction } from "discord.js";
import { commands } from "./commands.js";
import { config, playerIdFor } from "./config.js";
import { BackendClient, type PlayerState } from "./backend.js";
import { VoiceBridge } from "./voiceBridge.js";

// Message Content is privileged in Discord. Keep it opt-in so the bot remains
// online (and slash commands keep responding) until the intent is enabled in
// the Discord Developer Portal and ENABLE_MESSAGE_CONTENT=true is deployed.
const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
if (process.env.ENABLE_MESSAGE_CONTENT === "true") {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}
const client = new Client({ intents });
const backend = new BackendClient();
const voice = new VoiceBridge(client, backend);

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const guildIds = config.guildId && client.guilds.cache.has(config.guildId)
    ? [config.guildId]
    : [...client.guilds.cache.keys()];

  if (!guildIds.length) {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`[discord] registered ${commands.length} slash commands globally`);
    return;
  }

  let registered = 0;
  for (const guildId of guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commands });
      registered += 1;
      console.log(`[discord] registered ${commands.length} slash commands in guild ${guildId}`);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code === "50001") {
        console.error(`[discord] cannot access guild ${guildId}; skipping it.`);
        continue;
      }
      throw error;
    }
  }

  if (!registered) {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`[discord] registered ${commands.length} slash commands globally`);
  }
}

const memberVoice = async (interaction: ChatInputCommandInteraction) => {
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  return member?.voice;
};
const title = (track: PlayerState["current"]): string => track ? `**${track.title}** — ${track.author}` : "Nothing is playing.";
const replyError = async (interaction: ChatInputCommandInteraction, error: unknown): Promise<void> => { const message = error instanceof Error ? error.message : "Something went wrong."; if (interaction.replied || interaction.deferred) await interaction.editReply(`Error: ${message}`); else await interaction.reply({ content: `Error: ${message}`, ephemeral: true }); };

client.once("ready", async () => {
  console.log(`[discord] logged in as ${client.user?.tag}`);
  await registerCommands();
});
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;
  const playerId = playerIdFor(interaction.guildId);
  try {
    await interaction.deferReply();
    if (interaction.commandName === "play" || interaction.commandName === "p") {
      const voiceState = await memberVoice(interaction);
      const channel = voiceState?.channel;
      if (!channel) throw new Error("Join a voice channel first.");
      await voice.join(voiceState);
      const state = await backend.play(playerId, interaction.options.getString("query", true));
      await interaction.editReply(`Queued ${title(state.current)}${state.queue.length ? `\n${state.queue.length} more track${state.queue.length === 1 ? "" : "s"} up next.` : ""}`);
    } else if (interaction.commandName === "queue") {
      const query = interaction.options.getString("query");
      if (query) { const state = await backend.queue(playerId, query); await interaction.editReply(`Added to queue: ${title(state.queue.at(-1) || state.current)}`); }
      else { const state = await backend.state(playerId); const lines = state.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title} — ${track.author}`); await interaction.editReply(`Now playing: ${title(state.current)}\n${lines.length ? `\n**Up next**\n${lines.join("\n")}` : "\nQueue is empty."}`); }
    } else {
      const state = await backend.command(interaction.commandName, playerId);
      await interaction.editReply(interaction.commandName === "stop" ? "Playback stopped and queue cleared." : `${interaction.commandName[0].toUpperCase()}${interaction.commandName.slice(1)}d. ${title(state.current)}`);
      if (interaction.commandName === "stop") voice.leave(interaction.guildId);
    }
  } catch (error) { await replyError(interaction, error); }
});

// Prefix shortcut: `\p song name` behaves like `/play song name`.
const prefix = "\\p";
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(prefix)) return;
  const query = message.content.slice(prefix.length).trim();
  if (!query) {
    await message.reply("Usage: `\\p <song, artist, URL, or video ID>`");
    return;
  }

  try {
    const member = await message.guild.members.fetch(message.author.id);
    const voiceState = member.voice;
    if (!voiceState.channel) {
      await message.reply("Join a voice channel first.");
      return;
    }

    const playerId = playerIdFor(message.guild.id);
    await voice.join(voiceState);
    const state = await backend.play(playerId, query);
    await message.reply(`Queued ${title(state.current)}${state.queue.length ? `\n${state.queue.length} more track${state.queue.length === 1 ? "" : "s"} up next.` : ""}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Something went wrong.";
    await message.reply(`Error: ${reason}`);
  }
});

await client.login(config.token);
