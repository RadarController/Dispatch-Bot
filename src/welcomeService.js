const { DEFAULT_WELCOME_MESSAGES } = require('./welcomeMessages');
const { getWelcomeConfig } = require('./welcomeRegistry');

function getEffectiveWelcomeMessages(config) {
  return Array.isArray(config?.messages) && config.messages.length > 0
    ? config.messages
    : DEFAULT_WELCOME_MESSAGES;
}

function pickRandomMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * messages.length);
  return messages[index];
}

function renderWelcomeTemplate(template, member, config) {
  const userToken = config.useMentions ? `<@${member.id}>` : member.displayName;
  const rulesToken = config.rulesChannelId ? `<#${config.rulesChannelId}>` : 'the rules channel';

  return template
    .replace(/\{user\}/gi, userToken)
    .replace(/\{server\}/gi, member.guild.name)
    .replace(/\{rules\}/gi, rulesToken)
    .replace(/\{count\}/gi, `${member.guild.memberCount}`);
}

async function buildWelcomePreview(member, overrideTemplate = null) {
  const config = await getWelcomeConfig(member.guild.id);
  const messages = getEffectiveWelcomeMessages(config);
  const template = overrideTemplate || pickRandomMessage(messages);

  if (!template) {
    return null;
  }

  return {
    config,
    template,
    content: renderWelcomeTemplate(template, member, config)
  };
}

async function sendWelcomeMessage(member) {
  if (member.user.bot) {
    return null;
  }

  const preview = await buildWelcomePreview(member);

  if (!preview) {
    return null;
  }

  const { config, content } = preview;

  if (!config.enabled || !config.channelId) {
    return null;
  }

  const channel =
    member.guild.channels.cache.get(config.channelId) ||
    await member.guild.channels.fetch(config.channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  await channel.send({ content });
  return content;
}

module.exports = {
  buildWelcomePreview,
  getEffectiveWelcomeMessages,
  renderWelcomeTemplate,
  sendWelcomeMessage
};