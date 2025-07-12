// index.js (Combined Bot and Web Server)

// --- Load Environment Variables ---
// Make sure to call this at the very top
require('dotenv').config();

// --- Dependencies ---
const express = require('express');
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { Pool } = require('pg'); // Use the 'pg' package for PostgreSQL

// --- Environment Variables & Configuration ---
// These must be set in Render's environment variables dashboard
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const GAME_URL = process.env.GAME_URL;
const PORT = process.env.PORT || 3000; // Render provides the PORT variable automatically

// Critical check to ensure the application doesn't start with missing configuration
if (!TOKEN || !GUILD_ID || !VERIFIED_ROLE_ID || !DATABASE_URL || !GAME_URL) {
    console.error("FATAL ERROR: Missing one or more required environment variables.");
    process.exit(1); // Exit the process if configuration is incomplete
}

// =================================================================
// SECTION 1: EXPRESS WEB SERVER SETUP
// This part handles HTTP requests from your game.
// =================================================================

const app = express();
app.use(express.json()); // Middleware to parse incoming JSON bodies

// Initialize a lightweight Discord REST client for API actions without a full bot login
const rest = new REST({ version: '10' }).setToken(TOKEN);

// Health check endpoint. Visiting your Render URL should show this message.
app.get('/', (req, res) => {
    res.status(200).send('Verification system web server is online.');
});

// This is the specific endpoint your game will send a POST request to.
app.post('/verify-ingame', async (req, res) => {
    const { discordUserId } = req.body; // Expects a JSON body like: { "discordUserId": "12345..." }

    if (!discordUserId) {
        console.log('[WEB] Received a request missing a discordUserId.');
        return res.status(400).send({ error: 'Discord User ID is required.' });
    }

    console.log(`[WEB] Received in-game verification request for user ID: ${discordUserId}`);

    try {
        // Use the Discord API to kick the member from the guild
        await rest.delete(Routes.guildMember(GUILD_ID, discordUserId), {
            reason: 'Verification: Kicked by in-game confirmation.',
        });
        console.log(`[WEB] Successfully initiated kick for user ID: ${discordUserId}`);
        res.status(200).send({ message: 'User kick initiated successfully.' });
    } catch (error) {
        // This will catch errors like "Missing Permissions" or if the user is not in the server
        console.error(`[WEB] Failed to kick user ${discordUserId}:`, error);
        res.status(500).send({ error: 'An internal server error occurred while trying to kick the user.' });
    }
});


// =================================================================
// SECTION 2: DISCORD BOT SETUP
// This part connects to Discord's gateway to handle commands and DMs.
// =================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel], // Required to handle events in DMs
});

// Setup the connection pool for the PostgreSQL database
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Required for Render's free database tier
});

// Bot Ready Event: This runs once the bot successfully logs in.
client.once('ready', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}! Bot client is ready.`);
    
    // Register the slash command
    const commands = [{ name: 'verify', description: 'Starts the verification process to gain access to the server.' }];
    try {
        console.log('[BOT] Refreshing application (/) commands.');
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('[BOT] Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('[BOT] Failed to reload application commands:', error);
    }
});

// Slash Command Handler: Listens for when a user types /verify
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() || interaction.commandName !== 'verify') return;

    const user = interaction.user;
    console.log(`[BOT] /verify command used by ${user.tag} (${user.id}).`);

    try {
        // Construct the unique link and send it to the user's DMs
        const verificationLink = `${GAME_URL}?userId=${user.id}`;
        await user.send(
            `Hello! To verify your account, please complete the task at the following link:\n\n` +
            `${verificationLink}\n\n` +
            `After the in-game step is complete, come back to this DM and reply with the word \`DONE\`.`
        );

        // Send a temporary confirmation message in the channel
        await interaction.reply({
            content: 'I have sent you a DM with your personal verification link. Please check your messages!',
            ephemeral: true,
        });
    } catch (error) {
        console.error(`[BOT] Could not send DM to ${user.tag}.`, error);
        await interaction.reply({
            content: 'I could not send you a DM. Please enable "Allow direct messages from server members" in your User Settings > Privacy & Safety, then try the command again.',
            ephemeral: true
        });
    }
});

// DM Message Handler: Listens for the "DONE" reply
client.on('messageCreate', async message => {
    if (message.author.bot || message.guild) return; // Ignore bots and messages in server channels

    if (message.content.trim().toUpperCase() === 'DONE') {
        const user = message.author;
        console.log(`[BOT] Received 'DONE' from ${user.tag} (${user.id}).`);

        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const member = await guild.members.fetch(user.id).catch(() => null);

            if (member) {
                await member.roles.add(VERIFIED_ROLE_ID);
                await pool.query('INSERT INTO verified_users (user_id, verified_status) VALUES ($1, TRUE) ON CONFLICT (user_id) DO NOTHING', [user.id]);
                console.log(`[BOT] Successfully verified and assigned role to ${user.tag}.`);
                await user.send('✅ **Verification Successful!** You now have access to the server. Welcome!');
            } else {
                await user.send('I could not find you in the server. Please make sure you have rejoined the server before sending `DONE`.');
            }
        } catch (error) {
            console.error(`[BOT] An error occurred during the final verification step for ${user.tag}:`, error);
            await user.send('An unexpected error occurred. Please contact an administrator for help.');
        }
    }
});


// =================================================================
// SECTION 3: APPLICATION STARTUP
// =================================================================

// Start the Express web server
app.listen(PORT, () => {
    console.log(`[WEB] Web server is online and listening on port ${PORT}`);
});

// Start the Discord bot by logging in
client.login(TOKEN);
