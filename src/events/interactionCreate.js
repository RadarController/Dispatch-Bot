const { handleRolePanelInteraction, isRolePanelInteraction } = require('../rolesPanel');

module.exports = async (interaction, client) => {
  if (isRolePanelInteraction(interaction)) {
    try {
      await handleRolePanelInteraction(interaction);
    } catch (error) {
      console.error(`Role panel interaction failed: ${interaction.customId}`, error);

      const payload = {
        content: 'Something went wrong while updating your roles.',
        ephemeral: true
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
      ephemeral: true
    });
    return;
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`Command failed: ${interaction.commandName}`, error);

    const payload = {
      content: 'Something went wrong while running that command.',
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
};
