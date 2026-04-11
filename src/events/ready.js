const { REST, Routes } = require('discord.js');
const { config } = require('../config');

async function registerGuildCommands(client) {
  const commands = Array.from(client.commands.values()).map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: commands }
  );
}

module.exports = async (client) => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await registerGuildCommands(client);
    console.log(`Registered ${client.commands.size} guild command(s) for ${config.discordGuildId}`);
  } catch (error) {
    console.error('Failed to register guild commands:', error);
  }
};
