// server.js
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Required for fetching members
  ],
});

client.login(process.env.DISCORD_TOKEN);

// This is the endpoint your game will send a request to
app.post('/verify-ingame', async (req, res) => {
  const { discordUserId } = req.body;

  if (!discordUserId) {
    return res.status(400).send({ error: 'Discord User ID is required.' });
  }

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(discordUserId);

    if (member) {
      // Kick the member with a custom message
      await member.kick('REPLY DONE TO THE BOT');
      console.log(`Successfully kicked ${member.user.tag}.`);
      res.status(200).send({ message: 'User kicked successfully.' });
    } else {
      res.status(404).send({ error: 'User not found in the server.' });
    }
  } catch (error) {
    console.error('Error during in-game verification:', error);
    res.status(500).send({ error: 'An internal server error occurred.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Verification web server listening on port ${PORT}`);
});