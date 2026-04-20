const {
  ChannelType
} = require('discord.js');
const store = require('./store');
const { PLATFORM_LABELS, PLATFORMS } = require('./liveProviders');

const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
];

const DAY_LABELS = {
  monday: 'MON',
  tuesday: 'TUE',
  wednesday: 'WED',
  thursday: 'THU',
  friday: 'FRI',
  saturday: 'SAT',
  sunday: 'SUN'
};

const DEFAULT_AUTO_ARCHIVE_DURATION = 10080;

function normaliseUserId(userId) {
  const normalised = `${userId || ''}`.trim();
  if (!/^\d{17,20}$/.test(normalised)) {
    throw new Error('A valid Discord user ID is required.');
  }

  return normalised;
}

function getDefaultScheduleConfig() {
  return {
    ...store.getDefaultGuildState().scheduleConfig
  };
}

function getDefaultScheduleEntries() {
  return {
    ...store.getDefaultGuildState().schedules?.__template,
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: ''
  };
}

function createDefaultScheduleRecord(ownerUserId, displayName = '') {
  return {
    ownerUserId,
    displayName: String(displayName || '').trim(),
    threadId: '',
    rootMessageId: '',
    entries: getDefaultScheduleEntries(),
    updatedAt: null
  };
}

function cloneScheduleRecord(record, ownerUserId) {
  const fallback = createDefaultScheduleRecord(ownerUserId);

  return {
    ...fallback,
    ...(record || {}),
    ownerUserId,
    entries: {
      ...fallback.entries,
      ...(record?.entries || {})
    }
  };
}

function formatModeLabel(mode) {
  return mode === 'thread' ? 'Thread from message' : 'Forum post';
}

function renderScheduleTitle(scheduleConfig, schedule, fallbackUsername = '') {
  const template = scheduleConfig.titleFormat || 'Schedule | {displayName}';
  const displayName = schedule.displayName || fallbackUsername || `User ${schedule.ownerUserId}`;

  return template
    .replace(/\{displayName\}/gi, displayName)
    .replace(/\{username\}/gi, fallbackUsername || displayName)
    .slice(0, 100);
}

function truncateText(text, maxLength) {
  const stringValue = String(text || '');
  if (stringValue.length <= maxLength) {
    return stringValue;
  }

  return `${stringValue.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildFollowLinks(streamerRecord) {
  const links = [];

  for (const platform of PLATFORMS) {
    const channel = streamerRecord?.channels?.[platform];
    if (channel?.url) {
      links.push(`[${PLATFORM_LABELS[platform]}](${channel.url})`);
    }
  }

  return links;
}

function getDayPrefix(value) {
  if (!value) {
    return '⬜';
  }

  if (/^no stream$/i.test(value)) {
    return '❌';
  }

  return '✅';
}

function renderScheduleContent(guildState, schedule) {
  const lines = [];
  const streamerRecord = guildState.streamers?.[schedule.ownerUserId] || null;
  const followLinks = buildFollowLinks(streamerRecord);

  if (followLinks.length > 0) {
    lines.push('**Follow**');
    lines.push(followLinks.join(' | '));
    lines.push('');
  }

  for (const day of DAY_ORDER) {
    const entry = schedule.entries?.[day] || '';
    const prefix = getDayPrefix(entry);
    const value = entry || 'Not set';
    lines.push(`${prefix} ${DAY_LABELS[day]} - ${truncateText(value, 240)}`);
  }

  const content = lines.join('\n');
  return truncateText(content, 1900);
}

async function getScheduleConfig(guildId) {
  const guildState = await store.readGuildState(guildId);
  return {
    ...getDefaultScheduleConfig(),
    ...(guildState.scheduleConfig || {})
  };
}

async function setScheduleConfig(guildId, patch) {
  return store.updateGuildState(guildId, (guildState) => {
    guildState.scheduleConfig = {
      ...getDefaultScheduleConfig(),
      ...(guildState.scheduleConfig || {}),
      ...patch
    };

    return { ...guildState.scheduleConfig };
  });
}

async function clearScheduleConfig(guildId) {
  return store.updateGuildState(guildId, (guildState) => {
    guildState.scheduleConfig = {
      ...getDefaultScheduleConfig()
    };

    return { ...guildState.scheduleConfig };
  });
}

async function getCreatorSchedule(guildId, ownerUserId) {
  const normalisedOwnerUserId = normaliseUserId(ownerUserId);
  const guildState = await store.readGuildState(guildId);
  const record = guildState.schedules?.[normalisedOwnerUserId] || null;

  return record ? cloneScheduleRecord(record, normalisedOwnerUserId) : null;
}

async function ensureCreatorSchedule(guildId, ownerUserId, displayName) {
  const normalisedOwnerUserId = normaliseUserId(ownerUserId);

  return store.updateGuildState(guildId, (guildState) => {
    guildState.schedules = guildState.schedules || {};

    const existing = guildState.schedules[normalisedOwnerUserId];
    const next = cloneScheduleRecord(existing, normalisedOwnerUserId);
    next.displayName = String(displayName || next.displayName || '').trim();
    next.updatedAt = new Date().toISOString();

    guildState.schedules[normalisedOwnerUserId] = next;
    return cloneScheduleRecord(next, normalisedOwnerUserId);
  });
}

async function setCreatorScheduleEntry(guildId, ownerUserId, displayName, day, text) {
  const normalisedOwnerUserId = normaliseUserId(ownerUserId);
  const normalisedDay = String(day || '').trim().toLowerCase();

  if (!DAY_ORDER.includes(normalisedDay)) {
    throw new Error('A valid schedule day is required.');
  }

  return store.updateGuildState(guildId, (guildState) => {
    guildState.schedules = guildState.schedules || {};

    const next = cloneScheduleRecord(guildState.schedules[normalisedOwnerUserId], normalisedOwnerUserId);
    next.displayName = String(displayName || next.displayName || '').trim();
    next.entries[normalisedDay] = String(text || '').trim();
    next.updatedAt = new Date().toISOString();

    guildState.schedules[normalisedOwnerUserId] = next;
    return cloneScheduleRecord(next, normalisedOwnerUserId);
  });
}

async function removeCreatorScheduleEntry(guildId, ownerUserId, day) {
  const normalisedOwnerUserId = normaliseUserId(ownerUserId);
  const normalisedDay = String(day || '').trim().toLowerCase();

  if (!DAY_ORDER.includes(normalisedDay)) {
    throw new Error('A valid schedule day is required.');
  }

  return store.updateGuildState(guildId, (guildState) => {
    guildState.schedules = guildState.schedules || {};

    const next = cloneScheduleRecord(guildState.schedules[normalisedOwnerUserId], normalisedOwnerUserId);
    next.entries[normalisedDay] = '';
    next.updatedAt = new Date().toISOString();

    guildState.schedules[normalisedOwnerUserId] = next;
    return cloneScheduleRecord(next, normalisedOwnerUserId);
  });
}

async function clearCreatorScheduleEntries(guildId, ownerUserId) {
  const normalisedOwnerUserId = normaliseUserId(ownerUserId);

  return store.updateGuildState(guildId, (guildState) => {
    guildState.schedules = guildState.schedules || {};

    const next = cloneScheduleRecord(guildState.schedules[normalisedOwnerUserId], normalisedOwnerUserId);
    next.entries = getDefaultScheduleEntries();
    next.updatedAt = new Date().toISOString();

    guildState.schedules[normalisedOwnerUserId] = next;
    return cloneScheduleRecord(next, normalisedOwnerUserId);
  });
}

function countConfiguredEntries(schedule) {
  return DAY_ORDER.filter((day) => Boolean(schedule.entries?.[day])).length;
}

async function resolveConfiguredScheduleChannel(client, guildId, channelId) {
  if (!channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.guild?.id !== guildId) {
    return null;
  }

  return channel;
}

function validateScheduleChannel(channel, mode) {
  if (!channel) {
    return 'The configured schedule channel could not be found.';
  }

  if (mode === 'forum_post') {
    if (channel.type !== ChannelType.GuildForum) {
      return 'The configured schedule channel must be a Forum channel when schedule mode is set to forum_post.';
    }

    return '';
  }

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return 'The configured schedule channel must be a text or announcement channel when schedule mode is set to thread.';
  }

  return '';
}

async function createSchedulePost(channel, mode, title, content) {
  if (mode === 'forum_post') {
    const thread = await channel.threads.create({
      name: title,
      autoArchiveDuration: DEFAULT_AUTO_ARCHIVE_DURATION,
      message: {
        content,
        allowedMentions: { parse: [] }
      }
    });

    const starterMessage = await thread.fetchStarterMessage().catch(() => null);

    return {
      threadId: thread.id,
      rootMessageId: starterMessage?.id || ''
    };
  }

  const message = await channel.send({
    content,
    allowedMentions: { parse: [] }
  });

  const thread = await message.startThread({
    name: title,
    autoArchiveDuration: DEFAULT_AUTO_ARCHIVE_DURATION
  });

  return {
    threadId: thread.id,
    rootMessageId: message.id
  };
}

async function updateSchedulePost(client, guildState, scheduleConfig, schedule, title, content) {
  const channel = await resolveConfiguredScheduleChannel(
    client,
    guildState.__guildId,
    scheduleConfig.channelId
  );

  const validationError = validateScheduleChannel(channel, scheduleConfig.mode);
  if (validationError) {
    throw new Error(validationError);
  }

  let thread = schedule.threadId
    ? await client.channels.fetch(schedule.threadId).catch(() => null)
    : null;

  if (thread && typeof thread.setArchived === 'function') {
    await thread.setArchived(false).catch(() => null);
  }

  if (thread && typeof thread.setName === 'function' && thread.name !== title) {
    await thread.setName(title).catch(() => null);
  }

  let starterMessage = thread && typeof thread.fetchStarterMessage === 'function'
    ? await thread.fetchStarterMessage().catch(() => null)
    : null;

  if (!thread || !starterMessage) {
    return createSchedulePost(channel, scheduleConfig.mode, title, content);
  }

  await starterMessage.edit({
    content,
    allowedMentions: { parse: [] }
  });

  return {
    threadId: thread.id,
    rootMessageId: starterMessage.id
  };
}

async function publishCreatorSchedule(client, guild, ownerUserId, fallbackDisplayName = '') {
  const normalisedOwnerUserId = normaliseUserId(ownerUserId);
  const guildState = await store.readGuildState(guild.id);
  guildState.__guildId = guild.id;

  const scheduleConfig = {
    ...getDefaultScheduleConfig(),
    ...(guildState.scheduleConfig || {})
  };

  if (!scheduleConfig.channelId) {
    throw new Error('No schedule channel has been configured yet.');
  }

  if (!scheduleConfig.creatorRoleId) {
    throw new Error('No creator role has been configured yet.');
  }

  const existing = guildState.schedules?.[normalisedOwnerUserId];
  const schedule = cloneScheduleRecord(existing, normalisedOwnerUserId);

  if (!schedule.displayName) {
    schedule.displayName = String(fallbackDisplayName || '').trim();
  }

  const title = renderScheduleTitle(scheduleConfig, schedule, fallbackDisplayName);
  const content = renderScheduleContent(guildState, schedule);

  const result = await updateSchedulePost(client, guildState, scheduleConfig, schedule, title, content);

  const nextSchedule = {
    ...schedule,
    threadId: result.threadId,
    rootMessageId: result.rootMessageId,
    updatedAt: new Date().toISOString()
  };

  await store.updateGuildState(guild.id, (lockedGuildState) => {
    lockedGuildState.schedules = lockedGuildState.schedules || {};
    lockedGuildState.schedules[normalisedOwnerUserId] = nextSchedule;
    return cloneScheduleRecord(nextSchedule, normalisedOwnerUserId);
  });

  return {
    schedule: nextSchedule,
    title,
    content
  };
}

async function refreshCreatorSchedule(client, guild, ownerUserId, fallbackDisplayName = '') {
  return publishCreatorSchedule(client, guild, ownerUserId, fallbackDisplayName);
}

function buildScheduleStatusText(config, schedule) {
  const lines = [
    '**Schedule status**',
    `Mode: ${formatModeLabel(config.mode)}`,
    `Schedule channel: ${config.channelId ? `<#${config.channelId}>` : 'Not configured'}`,
    `Creator role: ${config.creatorRoleId ? `<@&${config.creatorRoleId}>` : 'Not configured'}`,
    `Title format: ${config.titleFormat || 'Not configured'}`
  ];

  if (!schedule) {
    lines.push('');
    lines.push('You do not have a saved schedule yet.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`Post/thread: ${schedule.threadId ? `<#${schedule.threadId}>` : 'Not created yet'}`);
  lines.push(`Configured days: ${countConfiguredEntries(schedule)}`);
  lines.push(`Last updated: ${schedule.updatedAt ? `<t:${Math.floor(new Date(schedule.updatedAt).getTime() / 1000)}:R>` : 'Never'}`);

  return lines.join('\n');
}

module.exports = {
  DAY_ORDER,
  DAY_LABELS,
  buildScheduleStatusText,
  clearCreatorScheduleEntries,
  clearScheduleConfig,
  countConfiguredEntries,
  ensureCreatorSchedule,
  formatModeLabel,
  getCreatorSchedule,
  getScheduleConfig,
  publishCreatorSchedule,
  refreshCreatorSchedule,
  removeCreatorScheduleEntry,
  setCreatorScheduleEntry,
  setScheduleConfig
};