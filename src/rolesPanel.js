const {
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require('discord.js');

const ROLE_PANEL_CUSTOM_ID_PREFIX = 'dispatch-role-panel';

function getConfiguredRoleIds() {
  return Array.from(
    new Set(
      (process.env.SELF_ASSIGNABLE_ROLE_IDS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function getRolePanelChannelId() {
  return (process.env.ROLE_PANEL_CHANNEL_ID || '').trim();
}

function getConfiguredRoles(guild) {
  return getConfiguredRoleIds()
    .map((roleId) => guild.roles.cache.get(roleId))
    .filter((role) => role && !role.managed && role.id !== guild.id);
}

function formatRoleMentions(roleIds, guild) {
  return roleIds
    .map((roleId) => guild.roles.cache.get(roleId))
    .filter(Boolean)
    .map((role) => `${role}`);
}

function chunkArray(items, size) {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function buildRolePanelContent() {
  return [
    '**Dispatch Bot role panel**',
    'Use the dropdown menus below to choose your self-assignable roles.',
    'Selecting a role adds it. Clearing a role removes it.'
  ].join('\n');
}

function buildRolePanelComponents(guild) {
  const roleGroups = chunkArray(getConfiguredRoles(guild), 25);

  return roleGroups.map((group, index) => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${ROLE_PANEL_CUSTOM_ID_PREFIX}:${index}`)
      .setPlaceholder(`Select roles (${index + 1}/${roleGroups.length})`)
      .setMinValues(0)
      .setMaxValues(group.length)
      .addOptions(
        group.map((role) => ({
          label: role.name.slice(0, 100),
          value: role.id,
          description: `Toggle ${role.name}`.slice(0, 100)
        }))
      );

    return new ActionRowBuilder().addComponents(menu);
  });
}

function buildRolePanelPayload(guild) {
  return {
    content: buildRolePanelContent(),
    components: buildRolePanelComponents(guild)
  };
}

function isRolePanelMessage(message) {
  return message.author?.id === message.client.user.id &&
    message.components.some((row) =>
      row.components.some((component) =>
        typeof component.customId === 'string' && component.customId.startsWith(`${ROLE_PANEL_CUSTOM_ID_PREFIX}:`)
      )
    );
}

function isRolePanelInteraction(interaction) {
  return interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ROLE_PANEL_CUSTOM_ID_PREFIX}:`);
}

function getRoleGroupForInteraction(interaction) {
  const index = Number.parseInt(interaction.customId.split(':')[1] || '', 10);
  if (!Number.isInteger(index) || index < 0) {
    return [];
  }

  return chunkArray(getConfiguredRoles(interaction.guild), 25)[index] || [];
}

async function getBotMember(guild) {
  return guild.members.fetchMe();
}

function getManageabilityProblems(botMember, roles) {
  const problems = [];

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    problems.push('Dispatch Bot is missing the Manage Roles permission.');
    return problems;
  }

  for (const role of roles) {
    if (role.position >= botMember.roles.highest.position) {
      problems.push(`I cannot manage ${role} because it is at or above my highest role.`);
    }
  }

  return problems;
}

async function ensureRolePanel(client) {
  const channelId = getRolePanelChannelId();
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
    console.error(`ROLE_PANEL_CHANNEL_ID ${channelId} is not a valid guild text channel.`);
    return null;
  }

  const payload = buildRolePanelPayload(channel.guild);
  if (payload.components.length === 0) {
    console.error('Role panel was requested, but no self-assignable roles are configured.');
    return null;
  }

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = messages?.find((message) => isRolePanelMessage(message)) || null;

  const panelMessage = existing
    ? await existing.edit(payload)
    : await channel.send(payload);

  if (!panelMessage.pinned) {
    try {
      await panelMessage.pin('Managed role panel for Dispatch Bot');
    } catch (error) {
      console.warn('Unable to pin role panel message:', error.message || error);
    }
  }

  return panelMessage;
}

async function handleRolePanelInteraction(interaction) {
  const roleGroup = getRoleGroupForInteraction(interaction);

  if (roleGroup.length === 0) {
    await interaction.reply({
      content: 'That role panel is not configured correctly anymore. Ask an admin to refresh it.',
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const botMember = await getBotMember(interaction.guild);
  const problems = getManageabilityProblems(botMember, roleGroup);

  if (problems.length > 0) {
    await interaction.reply({
      content: problems.join('\n'),
      ephemeral: true
    });
    return;
  }

  const groupRoleIds = new Set(roleGroup.map((role) => role.id));
  const selectedRoleIds = new Set(interaction.values.filter((roleId) => groupRoleIds.has(roleId)));
  const currentRoleIds = new Set(member.roles.cache.filter((role) => groupRoleIds.has(role.id)).map((role) => role.id));

  const toAdd = [...selectedRoleIds].filter((roleId) => !currentRoleIds.has(roleId));
  const toRemove = [...currentRoleIds].filter((roleId) => !selectedRoleIds.has(roleId));

  if (toAdd.length > 0) {
    await member.roles.add(toAdd, 'Self-assigned via Dispatch Bot role panel');
  }

  if (toRemove.length > 0) {
    await member.roles.remove(toRemove, 'Self-removed via Dispatch Bot role panel');
  }

  const lines = [];
  const addedMentions = formatRoleMentions(toAdd, interaction.guild);
  const removedMentions = formatRoleMentions(toRemove, interaction.guild);

  if (addedMentions.length > 0) {
    lines.push(`Added: ${addedMentions.join(', ')}`);
  }

  if (removedMentions.length > 0) {
    lines.push(`Removed: ${removedMentions.join(', ')}`);
  }

  if (lines.length === 0) {
    lines.push('No role changes were needed.');
  }

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true
  });
}

module.exports = {
  ensureRolePanel,
  formatRoleMentions,
  getConfiguredRoleIds,
  getConfiguredRoles,
  getRolePanelChannelId,
  handleRolePanelInteraction,
  isRolePanelInteraction
};
