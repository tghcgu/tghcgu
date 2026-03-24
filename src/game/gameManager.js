const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/database');
const phaseController = require('./phaseController');

async function sendRecruitEmbed(interaction, sessionId, scenario, maxPlayers, phases) {
  const phaseList = phases.map((p, i) => `${i + 1}. **${p.name}**`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🔪 ${scenario.title}`)
    .setColor(0x5865f2)
    .setDescription(scenario.overview)
    .addFields(
      { name: 'GM', value: `<@${interaction.user.id}>`, inline: true },
      { name: '最大人数', value: `${maxPlayers} 人`, inline: true },
      { name: '🗺️ フェーズ構成', value: phaseList },
      { name: '参加方法', value: '下のボタンを押すか `/game join` を使用' },
      { name: '開始方法', value: '全員参加後、GMが `/game begin` を実行' }
    )
    .setFooter({ text: `セッションID: ${sessionId}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${sessionId}`)
      .setLabel('参加する')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✋')
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function beginGame(interaction, session) {
  const players = db.getPlayers(session.id);
  if (players.length < 2) {
    return interaction.editReply({ content: '参加者が最低2人必要です。' });
  }

  const characters = db.getCharacters(session.scenario_id);
  if (players.length > characters.length) {
    return interaction.editReply({
      content: `参加者（${players.length}人）がキャラクター数（${characters.length}人）を超えています。`,
    });
  }

  // キャラクターをシャッフルして割り当て
  const shuffled = [...characters].sort(() => Math.random() - 0.5);
  for (let i = 0; i < players.length; i++) {
    db.db
      .prepare('UPDATE session_players SET character_id = ? WHERE session_id = ? AND user_id = ?')
      .run(shuffled[i].id, session.id, players[i].user_id);
  }

  db.updateSession(session.id, { status: 'playing', phase_index: 0 });

  // DM送信
  const dmResults = [];
  const scenario = db.getScenario(session.scenario_id);
  for (let i = 0; i < players.length; i++) {
    const char = shuffled[i];
    try {
      const user = await interaction.client.users.fetch(players[i].user_id);
      const dmEmbed = new EmbedBuilder()
        .setTitle(`🎭 あなたの役割：${char.name}`)
        .setColor(char.is_killer ? 0xed4245 : 0x5865f2)
        .addFields(
          { name: '📖 事件概要', value: scenario.overview },
          { name: '👤 公開プロフィール', value: char.description },
          { name: '🔐 あなただけが知る秘密', value: char.secret },
          {
            name: char.is_killer ? '⚠️ あなたは犯人です' : '🔍 あなたは探偵です',
            value: char.is_killer
              ? '他のプレイヤーに悟られないようにしましょう。'
              : '議論を通じて犯人を見つけてください。',
          }
        )
        .setFooter({ text: 'この情報は絶対に他のプレイヤーに見せないでください！' });
      await user.send({ embeds: [dmEmbed] });
      dmResults.push(`✅ <@${players[i].user_id}>`);
    } catch {
      dmResults.push(`❌ <@${players[i].user_id}> (DM送信失敗)`);
    }
  }

  // ゲーム開始 Embed
  const updatedPlayers = db.getPlayers(session.id);
  const startEmbed = new EmbedBuilder()
    .setTitle(`🔪 ゲーム開始：${scenario.title}`)
    .setColor(0xfee75c)
    .setDescription(scenario.overview)
    .addFields(
      { name: '👥 参加者と役割', value: updatedPlayers.map((p) => `<@${p.user_id}> → **${p.char_name}**`).join('\n') },
      { name: '📨 DM送信結果', value: dmResults.join('\n') }
    );

  await interaction.editReply({ embeds: [startEmbed] });

  // 最初のフェーズを通知
  const updatedSession = db.getSession(session.id);
  await phaseController.announcePhase(interaction.channel, updatedSession);
}

module.exports = { sendRecruitEmbed, beginGame };
