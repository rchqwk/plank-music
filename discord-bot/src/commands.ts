import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder().setName("play").setDescription("Play or queue a search result").addStringOption((option) => option.setName("query").setDescription("Song, artist, URL, or video ID").setRequired(true)),
  new SlashCommandBuilder().setName("p").setDescription("Shortcut for play").addStringOption((option) => option.setName("query").setDescription("Song, artist, URL, or video ID").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume the current track"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip to the next track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show or add to the queue").addStringOption((option) => option.setName("query").setDescription("Optional song to add to the queue").setRequired(false)),
].map((command) => command.toJSON());
