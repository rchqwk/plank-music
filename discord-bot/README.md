# Discord bot bridge

This service registers `/play`, `/p`, `/pause`, `/resume`, `/skip`, `/stop`, and `/queue` commands. It joins the invoker's voice channel, forwards Discord's voice gateway `sessionId`/`token`/`endpoint` to the backend's `/api/player/voice`, and sends playback commands to `/api/player/*`. Each guild gets an independent backend player ID.

The text shortcut is `\\p <song, artist, URL, or video ID>`. Discord treats message content as a privileged intent: enable **Message Content Intent** under the bot settings in the Discord Developer Portal, then set `ENABLE_MESSAGE_CONTENT=true`. Until both are enabled, the bot stays online and `/play` or `/p` continue to work, but Discord will not deliver message text to the bot.

## Run locally

```bash
npm install
cp .env.example .env
# set DISCORD_TOKEN and DISCORD_CLIENT_ID
npm run typecheck
npm run build
npm start
```

`DISCORD_GUILD_ID` is optional but recommended while developing because guild command registration is immediate. Without it, commands are registered globally and Discord can take time to propagate them. The bot needs the `bot` and `applications.commands` scopes, plus Connect and Speak permissions in voice channels.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token |
| `DISCORD_CLIENT_ID` | yes | Discord application/client ID |
| `DISCORD_GUILD_ID` | no | Development guild for fast command registration |
| `BACKEND_URL` | no | Backend base URL, default `http://localhost:4000` |
| `PLAYER_ID_PREFIX` | no | Optional prefix for guild player IDs |
| `ENABLE_MESSAGE_CONTENT` | no | Set `true` only after enabling Discord's Message Content privileged intent; enables `\\p` |
