// server.js
require('dotenv').config();
const express = require('express');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// --- Environment Variables ---
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !GUILD_ID) {
    console.error("Fatal Error: Missing DISCORD_TOKEN or GUILD_ID in environment variables.");
    process.exit(1);
}

// --- Initialize Express App ---
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- Initialize Discord REST client ---
// This is a lightweight way to talk to the Discord API without logging in as a full bot.
const rest = new REST({ version: '10' }).setToken(TOKEN);

// --- The Endpoint Your Game Will Call ---
app.post('/verify-ingame', async (req, res) => {
  const { discordUserId } = req.body;

  if (!discordUserId) {
    console.log('Received a request without a discordUserId.');
    return res.status(400).send({ error: 'Discord User ID is required.' });
  }

  console.log(`Received verification request for user ID: ${discordUserId}`);

  try {
    // This is the API call to kick a member from the guild.
    await rest.delete(
        Routes.guildMember(GUILD_ID, discordUserId),
        { reason: 'REPLY DONE TO THE BOT' } // The reason is shown in the audit log
    );
    
    console.log(`Successfully initiated kick for user ID: ${discordUserId}`);
    // We can't customize the kick message itself, Discord doesn't support that directly.
    // The instructions are given by the main bot in DMs.
    res.status(200).send({ message: 'User kick initiated successfully.' });

  } catch (error) {
    console.error(`Failed to kick user ${discordUserId}:`, error);
    res.status(500).send({ error: 'An internal server error occurred while trying to kick the user.' });
  }
});

app.listen(PORT, () => {
  console.log(`Verification web server is online and listening on port ${PORT}`);
});
