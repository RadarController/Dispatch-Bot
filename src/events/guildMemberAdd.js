const { sendWelcomeMessage } = require('../welcomeService');

module.exports = async (member) => {
  await sendWelcomeMessage(member);
};