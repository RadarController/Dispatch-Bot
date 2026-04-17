const { startLiveMonitor } = require('../liveService');
const { ensureRolePanels } = require('../rolesPanel');
const { REST, Routes } = require('discord.js');
const { config } = require('../config');

async function registerCommands(client) {
    const commands = Array.from(client.commands.values()).map((command) => command.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(config.discordToken);

    if (config.discordGuildId) {
        await rest.put(
            Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
            { body: commands }
        );
        console.log(`Registered ${client.commands.size} guild command(s) for ${config.discordGuildId}.`);
        return;
    }

    await rest.put(
        Routes.applicationCommands(config.discordClientId),
        { body: commands }
    );
    console.log(`Registered ${client.commands.size} global command(s).`);
}

module.exports = async (client) => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        await registerCommands(client);
    } catch (error) {
        console.error('Failed to register commands:', error);
    }

    try {
        const refreshedPanels = await ensureRolePanels(client);
        if (refreshedPanels > 0) {
            console.log(`Ensured ${refreshedPanels} configured role panel(s).`);
        }
    } catch (error) {
        console.error('Failed to ensure role panels:', error);
    }

    try {
        await startLiveMonitor(client);
    } catch (error) {
        console.error('Failed to start live monitor:', error);
    }
};