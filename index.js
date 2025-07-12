// index.js

// --- Load Environment Variables ---
// Make sure to call this at the very top
require('dotenv').config();

// --- Dependencies ---
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { Pool } = require('pg'); // Use the 'pg' package for PostgreSQL

// --- Environment Variables ---
// Ensure these are set in your .env file or Render's environment variables
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const DATABASE_URL = process.env.DATABASE_URL; // Provided by Render
const GAME_URL = process.env.GAME_URL; // Add your game's base URL to .env

if (!TOKEN || !GUILD_ID || !VERIFIED_ROLE_ID || !DATABASE_URL || !GAME_URL) {
    console.error("Fatal Error: Missing one or more required environment variables.");
    process.exit(1); // Exit if critical variables are not set
}


// --- Initialize Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,    // Required to receive and send DMs
    GatewayIntentBits.MessageContent,    // Required to read the content of messages ("DONE")
  ],
  partials: [Partials.Channel], // Required to handle DM channel events
});


// --- PostgreSQL Database Setup ---
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    // This is required for connecting to Render's free PostgreSQL service
    rejectUnauthorized: false,
  },
});

// --- Function to Create Database Table on Startup ---
const ensureTableExists = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS verified_users (
      user_id TEXT PRIMARY KEY,
      verified_status BOOLEAN DEFAULT FALSE,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  try {
    await pool.query(createTableQuery);
    console.log('Database table "verified_users" is ready.');
  } catch (err) {
    console.error('Error creating database table:', err);
    // Exit if the bot can't connect to the DB
    process.exit(1);
  }
};


// --- Register Slash Command ---
const commands = [{
    name: 'verify',
    description: 'Starts the verification process to gain access to the server.'
}];
const rest = new REST({ version: '10' }).setToken(TOKEN);


// --- Bot Ready Event ---
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}! Bot is online.`);

  // Ensure the database table is ready before the bot starts operating
  await ensureTableExists();

  // Register slash commands for the specific guild
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Failed to reload application commands:', error);
  }
});


// --- Slash Command Handler (/verify) ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() || interaction.commandName !== 'verify') return;

  const user = interaction.user;
  console.log(`Verification process started by ${user.tag} (${user.id}).`);

  try {
    // Construct a unique verification link for the user
    const verificationLink = `${GAME_URL}?userId=${user.id}`;
    
    // Send the link via Direct Message
    await user.send(
        `Hello! To verify your account, please complete the task at the following link:\n\n` +
        `${verificationLink}\n\n` +
        `After you are kicked from the game, come back to this DM and reply with the word \`DONE\`.`
    );

    // Confirm to the user in the channel that a DM was sent
    await interaction.reply({
        content: 'I have sent you a DM with your personal verification link. Please check your messages!',
        ephemeral: true // This message is only visible to the user who typed the command
    });

  } catch (error) {
    // This block runs if the bot cannot DM the user (e.g., DMs are disabled)
    console.error(`Could not send DM to ${user.tag}.`, error);
    await interaction.reply({
        content: 'I could not send you a DM. Please enable "Allow direct messages from server members" in your User Settings > Privacy & Safety, then try again.',
        ephemeral: true
    });
  }
});


// --- DM Message Handler (Listens for "DONE") ---
client.on('messageCreate', async message => {
  // Ignore messages from other bots and any messages sent in a server channel
  if (message.author.bot || message.guild) return;

  // Check if the message content is exactly "DONE" (case-insensitive)
  if (message.content.trim().toUpperCase() === 'DONE') {
    const user = message.author;
    console.log(`Received 'DONE' from ${user.tag} (${user.id}).`);

    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (member) {
        // Add the verified role
        await member.roles.add(VERIFIED_ROLE_ID);
        
        // Update database record
        await pool.query(
            'INSERT INTO verified_users (user_id, verified_status) VALUES ($1, TRUE) ON CONFLICT (user_id) DO UPDATE SET verified_status = TRUE, timestamp = NOW()',
            [user.id]
        );
        
        console.log(`Successfully verified and assigned role to ${user.tag}.`);
        await user.send('✅ **Verification Successful!** You now have access to the server. Welcome!');
      } else {
        // This happens if the user says "DONE" but hasn't rejoined the server yet
        console.log(`User ${user.tag} sent 'DONE' but was not found in the guild.`);
        await user.send('I could not find you in the server. Please make sure you have rejoined the server, then send `DONE` again.');
      }
    } catch (error) {
      console.error(`An error occurred during the final verification step for ${user.tag}:`, error);
      await user.send('An unexpected error occurred. Please contact an administrator for help.');
    }
  }
});


// --- Login to Discord ---
client.login(TOKEN);