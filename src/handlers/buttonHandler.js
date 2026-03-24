const db = require('../db/database');
const phaseController = require('../game/phaseController');

async function handleButton(interaction) {
  const { customId } = interaction;

  // join_<sessionId>
  if (customId.startsWith('join_')) {
    const sessionId = Number(customId.replace('join_', ''));
    const session = db.getSession(sessionId);

    if (!session || session.status !== 'waiting') {
      return interaction.reply({ content: 'このゲームへの参加は受け付けていません。', ephemeral: true });
    }
    if (db.isPlayerInSession(sessionId, interaction.user.id)) {
      return interaction.reply({ content: '既に参加登録済みです。', ephemeral: true });
    }

    db.addPlayer({ session_id: sessionId, user_id: interaction.user.id, character_id: 0 });
    const players = db.getPlayers(sessionId);
    await interaction.reply({ content: `✅ <@${interaction.user.id}> が参加しました！（現在 ${players.length} 人）` });
    return;
  }

  // ready_<sessionId>_<phaseIndex>
  if (customId.startsWith('ready_')) {
    const parts = customId.split('_');
    const sessionId = Number(parts[1]);
    const phaseIndex = Number(parts[2]);
    await phaseController.handleReadyButton(interaction, sessionId, phaseIndex);
    return;
  }
}

module.exports = { handleButton };
