const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { getMissingRequiredConfig } = require('./config');

const missing = getMissingRequiredConfig();
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration
  ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((name) => name.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command?.data && typeof command.execute === 'function') {
    client.commands.set(command.data.name, command);
  }
}

const readyHandler = require('./events/ready');
const interactionCreateHandler = require('./events/interactionCreate');
const guildMemberAddHandler = require('./events/guildMemberAdd');

client.once('clientReady', () => {
  readyHandler(client).catch((error) => {
    console.error('Ready handler failed:', error);
  });
});

client.on('interactionCreate', (interaction) => {
  interactionCreateHandler(interaction, client).catch((error) => {
    console.error('Interaction handler failed:', error);
  });
});

client.on('guildMemberAdd', (member) => {
  guildMemberAddHandler(member).catch((error) => {
    console.error('Guild member add handler failed:', error);
  });
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});