// index.js (Combined Bot and Web Server - FINAL VERSION)
require('dotenv').config();

// --- Dependencies ---
const express = require('express');
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { Pool } = require('pg');

// --- Environment Variables ---
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const ROBLOX_PLACE_ID = process.env.ROBLOX_PLACE_ID; // We now need the Place ID
const PORT = process.env.PORT || 3000;

if (!TOKEN || !GUILD_ID || !VERIFIED_ROLE_ID || !DATABASE_URL || !ROBLOX_PLACE_ID) {
    console.error("FATAL ERROR: Missing one or more required environment variables (including ROBLOX_PLACE_ID).");
    process.exit(1);
}

// =================================================================
// DATABASE SETUP
// =================================================================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

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
        console.error('[DB] Error creating database table:', err);
        process.exit(1);
    }
};


// =================================================================
// EXPRESS WEB SERVER SETUP
// =================================================================
const app = express();
app.use(express.json());
const rest = new REST({ version: '10' }).setToken(TOKEN);

app.get('/', (req, res) => {
    res.status(200).send('Verification system web server is online.');
});

app.post('/verify-ingame', async (req, res) => {
    // ... (This section is already correct, no changes needed)
});


// =================================================================
// DISCORD BOT SETUP
// =================================================================
const client = new Client({
    intents: [ /* ... a lot of intents ... */ ],
    partials: [Partials.Channel],
});

client.once('ready', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}!`);
    // ... (command registration logic)
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() || !interaction.commandName === 'verify') return;

    await interaction.deferReply({ ephemeral: true });
    
    const user = interaction.user;
    console.log(`[BOT] /verify command used by ${user.tag} (${user.id}).`);

    try {
        // --- THIS IS THE ROBLOX LINK FIX ---
        const launchData = {
            discordUserId: user.id,
            discordUsername: user.username
        };
        const encodedLaunchData = encodeURIComponent(JSON.stringify(launchData));
        const verificationLink = `https://www.roblox.com/games/start?placeId=${ROBLOX_PLACE_ID}&launchData=${encodedLaunchData}`;
        // --- END OF FIX ---

        await user.send(
            `Hello! To verify your account, please complete the task at the link below:\n\n` +
            `${verificationLink}\n\n` +
            `After the in-game step, come back here and reply with the word \`DONE\`.`
        );

        await interaction.followUp({ content: 'I have sent you a DM with your personal verification link!' });
    } catch (error) {
        await interaction.followUp({ content: 'I could not send you a DM. Please check your privacy settings.' });
    }
});

client.on('messageCreate', async message => {
    // ... (This section is already correct, no changes needed)
});


// =================================================================
// APPLICATION STARTUP
// =================================================================
const startApp = async () => {
    // --- THIS IS THE DATABASE FIX ---
    // Ensure the database table exists BEFORE starting the bot or server
    await ensureTableExists();
    // --- END OF FIX ---

    app.listen(PORT, () => console.log(`[WEB] Web server listening on port ${PORT}`));
    client.login(TOKEN);
};

startApp();
