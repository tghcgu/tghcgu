const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/database');

/**
 * Post a recruitment embed and update session with players joining via button.
 */
async function sendRecruitEmbed(interaction, sessionId, scenario, maxPlayers) {
  const embed = new EmbedBuilder()
    .setTitle(`🔪 ${scenario.title}`)
    .setColor(0x5865f2)
    .setDescription(scenario.overview)
    .addFields(
      { name: 'GM', value: `<@${interaction.user.id}>`, inline: true },
      { name: '最大人数', value: `${maxPlayers} 人`, inline: true },
      { name: '参加方法', value: '下のボタンを押すか `/game join` コマンドを使用' },
      { name: '開始方法', value: `全員が参加したら GM が \`/game begin\` を実行` }
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

/**
 * Assign characters randomly to players and send DMs with role cards.
 */
async function beginGame(interaction, session) {
  const players = db.getPlayers(session.id);
  if (players.length < 2) {
    return interaction.editReply({ content: '参加者が最低2人必要です。' });
  }

  const characters = db.getCharacters(session.scenario_id);
  if (players.length > characters.length) {
    return interaction.editReply({
      content: `参加者（${players.length}人）がキャラクター数（${characters.length}人）を超えています。シナリオにキャラクターを追加してください。`,
    });
  }

  // Shuffle characters
  const shuffled = [...characters].sort(() => Math.random() - 0.5);

  // Assign characters to players
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const char = shuffled[i];
    db.db
      .prepare('UPDATE session_players SET character_id = ? WHERE session_id = ? AND user_id = ?')
      .run(char.id, session.id, player.user_id);
  }

  // Update session status
  db.updateSession(session.id, { status: 'playing', phase: 'intro' });

  // Send DMs with role cards
  const dmResults = [];
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const char = shuffled[i];
    try {
      const user = await interaction.client.users.fetch(player.user_id);
      const scenario = db.getScenario(session.scenario_id);
      const dmEmbed = new EmbedBuilder()
        .setTitle(`🎭 あなたの役割：${char.name}`)
        .setColor(char.is_killer ? 0xed4245 : 0x5865f2)
        .addFields(
          { name: '📖 事件概要', value: scenario.overview },
          { name: '👤 公開プロフィール', value: char.description },
          { name: '🔐 あなただけが知る秘密', value: char.secret },
          { name: char.is_killer ? '⚠️ あなたは犯人です' : '🔍 あなたは探偵です', value: char.is_killer ? '他のプレイヤーに悟られないようにしましょう。' : '議論を通じて犯人を見つけてください。' }
        )
        .setFooter({ text: 'この情報は絶対に他のプレイヤーに見せないでください！' });
      await user.send({ embeds: [dmEmbed] });
      dmResults.push(`✅ <@${player.user_id}>`);
    } catch {
      dmResults.push(`❌ <@${player.user_id}> (DMが送れませんでした)`);
    }
  }

  // Announce game start in channel
  const scenario = db.getScenario(session.scenario_id);
  const updatedPlayers = db.getPlayers(session.id);

  const startEmbed = new EmbedBuilder()
    .setTitle(`🔪 ゲーム開始：${scenario.title}`)
    .setColor(0xfee75c)
    .setDescription(scenario.overview)
    .addFields(
      {
        name: '👥 参加者と役割',
        value: updatedPlayers
          .map((p) => `<@${p.user_id}> → **${p.char_name}**`)
          .join('\n'),
      },
      {
        name: '📨 DM送信結果',
        value: dmResults.join('\n'),
      },
      {
        name: '📋 ゲームの流れ',
        value: `1. **導入** → 各自DMで役割カードを確認\n2. **調査** → \`/game investigate <clue_id>\` で手がかりを調査\n3. **議論** → チャットで自由に議論（GMが \`/game phase\` で移行）\n4. **投票** → \`/game vote @player\` で犯人に投票\n5. **結末** → 真相公開`,
      }
    )
    .setFooter({ text: 'GMは /game phase で次のフェーズに進められます' });

  await interaction.editReply({ embeds: [startEmbed] });
}

module.exports = { sendRecruitEmbed, beginGame };
