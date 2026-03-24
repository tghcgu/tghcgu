require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { loadCommands, handleCommand } = require('./handlers/commandHandler');
const { handleModal } = require('./handlers/modalHandler');
const { handleButton } = require('./handlers/buttonHandler');
const { startWebServer } = require('../web/server');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

loadCommands(client);

client.once(Events.ClientReady, (c) => {
  console.log(`[Discord] Logged in as ${c.user.tag}`);
  startWebServer(process.env.WEB_PORT || 3000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModal(interaction);
  } else if (interaction.isButton()) {
    await handleButton(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN);
