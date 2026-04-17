const { MessageFlags } = require('discord.js');
const { handleRolePanelInteraction, isRolePanelInteraction } = require('../rolesPanel');

module.exports = async (interaction, client) => {
  if (isRolePanelInteraction(interaction)) {
    try {
      await handleRolePanelInteraction(interaction);
    } catch (error) {
      console.error(`Role panel interaction failed: ${interaction.customId}`, error);

      const payload = {
        content: 'Something went wrong while updating your roles.',
        flags: MessageFlags.Ephemeral
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
        return;
      }

      await interaction.reply(payload);
    }

    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      content: 'That command is not available right now.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`Command failed: ${interaction.commandName}`, error);

    const payload = {
      content: 'Something went wrong while running that command.',
      flags: MessageFlags.Ephemeral
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
};