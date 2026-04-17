const { REST, Routes } = require('discord.js');
const { config } = require('./config');

async function main() {
    if (!config.discordGuildId) {
        throw new Error('DISCORD_GUILD_ID is required to clear guild commands.');
    }

    const rest = new REST({ version: '10' }).setToken(config.discordToken);

    await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
        { body: [] }
    );

    console.log(`Cleared guild commands for ${config.discordGuildId}.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});