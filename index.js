// index.js (Combined Bot and Web Server - FINAL VERSION)

// --- Load Environment Variables ---
// Must be at the very top of the file
require('dotenv').config();

// --- Dependencies ---
const express = require('express');
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { Pool } = require('pg'); // PostgreSQL driver

// --- Environment Variables & Configuration ---
// These MUST be set in your Render environment variables dashboard
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const ROBLOX_PLACE_ID = process.env.ROBLOX_PLACE_ID; // The ID of your game's start place
const PORT = process.env.PORT || 3000; // Render provides the PORT variable automatically

// Critical check to ensure the application doesn't start with missing configuration
if (!TOKEN || !GUILD_ID || !VERIFIED_ROLE_ID || !DATABASE_URL || !ROBLOX_PLACE_ID) {
    console.error("FATAL ERROR: Missing one or more required environment variables (Did you set ROBLOX_PLACE_ID?).");
    process.exit(1); // Exit if configuration is incomplete
}

// =================================================================
// SECTION 1: DATABASE SETUP
// =================================================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // Required for Render's free PostgreSQL tier
    },
});

// Function to create the database table if it doesn't already exist
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
        console.log('[DB] Table "verified_users" is ready.');
    } catch (err) {
        console.error('[DB] FATAL: Error creating database table:', err);
        process.exit(1); // Exit if the bot can't connect to or set up the DB
    }
};

// =================================================================
// SECTION 2: EXPRESS WEB SERVER SETUP
// =================================================================
const app = express();
app.use(express.json()); // Middleware to parse incoming JSON requests
const rest = new REST({ version: '10' }).setToken(TOKEN);

// Health check endpoint. You can visit your Render URL to see this message.
app.get('/', (req, res) => {
    res.status(200).send('Verification system web server is online.');
});

// The endpoint your Roblox game sends the POST request to
app.post('/verify-ingame', async (req, res) => {
    const { discordUserId } = req.body;
    if (!discordUserId) return res.status(400).send({ error: 'Discord User ID is required.' });

    // DEBUG: Acknowledge that the "Yes" button was clicked in Roblox
    console.log(`[WEB - STEP 2/4] In-game "Yes" button clicked. Received request for user ID: ${discordUserId}`);

    try {
        await rest.delete(Routes.guildMember(GUILD_ID, discordUserId), {
            reason: 'Verification: Kicked by in-game confirmation.',
        });
        // DEBUG: Confirm the kick command was sent successfully
        console.log(`[WEB - STEP 2/4] Successfully sent kick command to Discord for user ID: ${discordUserId}`);
        res.status(200).send({ message: 'User kick initiated successfully.' });
    } catch (error) {
        console.error(`[WEB] Failed to kick user ${discordUserId}:`, error.message);
        res.status(500).send({ error: 'An internal server error occurred.' });
    }
});


// =================================================================
// SECTION 3: DISCORD BOT SETUP
// =================================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

client.once('ready', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}!`);
    const commands = [{ name: 'verify', description: 'Starts the verification process.' }];
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('[BOT] Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('[BOT] Failed to reload application commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() || interaction.commandName !== 'verify') return;

    await interaction.deferReply({ ephemeral: true });
    
    const user = interaction.user;
    // DEBUG: A user has started the process
    console.log(`[BOT - STEP 1/4] /verify command executed by ${user.tag} (${user.id}).`);

    try {
        // Correctly format the launch data for Roblox
        const launchData = {
            discordUserId: user.id,
            discordUsername: user.username
        };
        const encodedLaunchData = encodeURIComponent(JSON.stringify(launchData));
        const verificationLink = `https://www.roblox.com/games/start?placeId=${ROBLOX_PLACE_ID}&launchData=${encodedLaunchData}`;

        await user.send(
            `Hello! Please complete the task at the link below:\n\n` +
            `${verificationLink}\n\n` +
            `After the in-game step, reply here with the word \`DONE\`.`
        );

        await interaction.followUp({ content: 'I have sent you a DM with your personal verification link!' });
    } catch (error) {
        console.error(`[BOT] Could not send DM to ${user.tag}.`, error);
        await interaction.followUp({ content: 'I could not send you a DM. Please check your privacy settings.' });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || message.guild) return;

    if (message.content.trim().toUpperCase() === 'DONE') {
        const user = message.author;
        // DEBUG: The user has replied "DONE" after being kicked
        console.log(`[BOT - STEP 3/4] Received 'DONE' from ${user.tag} (${user.id}).`);

        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const member = await guild.members.fetch(user.id).catch(() => null);

            if (member) {
                await member.roles.add(VERIFIED_ROLE_ID);
                await pool.query('INSERT INTO verified_users (user_id, verified_status) VALUES ($1, TRUE) ON CONFLICT (user_id) DO UPDATE SET verified_status = TRUE, timestamp = NOW()', [user.id]);
                // DEBUG: Final confirmation of success
                console.log(`[BOT - STEP 4/4] Verification complete! Assigned role to ${user.tag}.`);
                await user.send('✅ **Verification Successful!** You now have access to the server. Welcome!');
            } else {
                await user.send('I could not find you in the server. Please ensure you have rejoined before sending `DONE`.');
            }
        } catch (error) {
            console.error(`[BOT] Error during final verification for ${user.tag}:`, error);
            await user.send('An unexpected error occurred. Please contact an admin.');
        }
    }
});

// =================================================================
// SECTION 4: APPLICATION STARTUP
// =================================================================
const startApp = async () => {
    // Ensure the database table exists BEFORE starting the bot or server
    await ensureTableExists();

    // Start the web server to listen for requests from Roblox
    app.listen(PORT, () => console.log(`[WEB] Web server listening on port ${PORT}`));

    // Start the Discord bot by logging in
    client.login(TOKEN);
};

// Run the application
startApp();
