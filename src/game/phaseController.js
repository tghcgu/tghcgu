const { EmbedBuilder } = require('discord.js');
const db = require('../db/database');

const PHASE_LABELS = {
  intro: '導入',
  investigation: '調査',
  discussion: '議論',
  voting: '投票',
  reveal: '結末',
};

async function moveToPhase(interaction, session, nextPhase) {
  db.updateSession(session.id, { phase: nextPhase });

  const phaseEmbeds = {
    investigation: new EmbedBuilder()
      .setTitle('🔍 調査フェーズ開始')
      .setColor(0x57f287)
      .setDescription(
        '各プレイヤーは `/game investigate <clue_id>` コマンドを使って手がかりを調査できます。\n調査した結果はこのチャンネルに公開されます。'
      )
      .addFields({ name: '手がかり一覧の確認', value: '`/scenario view <scenario_id>` で確認できます' }),

    discussion: new EmbedBuilder()
      .setTitle('💬 議論フェーズ開始')
      .setColor(0xfee75c)
      .setDescription(
        'これまでに明らかになった情報を元に、自由に議論してください。\n犯人は誰だと思いますか？'
      )
      .addFields({
        name: '公開された手がかり',
        value: buildRevealedCluesList(session) || 'なし',
      }),

    voting: new EmbedBuilder()
      .setTitle('🗳️ 投票フェーズ開始')
      .setColor(0xed4245)
      .setDescription('犯人だと思う人物に投票してください！\n`/game vote @player` で投票できます。\n**全員が投票すると自動的に結果が発表されます。**')
      .addFields({ name: '参加者', value: buildPlayersList(session) }),
  };

  const embed = phaseEmbeds[nextPhase];
  if (!embed) {
    return interaction.reply({ content: `不明なフェーズ: ${nextPhase}`, ephemeral: true });
  }

  await interaction.reply({ embeds: [embed] });
}

async function announceClue(interaction, clue) {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 手がかり発見：${clue.name}`)
    .setColor(0x57f287)
    .setDescription(clue.description)
    .setFooter({ text: `手がかりID: ${clue.id}` });

  await interaction.reply({ embeds: [embed] });
}

async function revealResults(interaction, session) {
  const votes = db.getVotes(session.id);
  const players = db.getPlayers(session.id);
  const scenario = db.getScenario(session.scenario_id);

  // Count votes
  const tally = {};
  for (const vote of votes) {
    tally[vote.target_id] = (tally[vote.target_id] || 0) + 1;
  }

  // Find most voted
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const [topUserId, topCount] = sorted[0] || ['', 0];

  // Find the actual killer
  const killer = players.find((p) => p.is_killer);

  // Build vote summary
  const voteSummary = await Promise.all(
    sorted.map(async ([userId, count]) => {
      const player = players.find((p) => p.user_id === userId);
      return `<@${userId}> (${player?.char_name || '?'}) — **${count}票**`;
    })
  );

  const correct = killer && topUserId === killer.user_id;

  const embed = new EmbedBuilder()
    .setTitle('🎭 投票結果 & 真相公開')
    .setColor(correct ? 0x57f287 : 0xed4245)
    .addFields(
      { name: '📊 投票結果', value: voteSummary.join('\n') || 'なし' },
      {
        name: '最多得票',
        value: topUserId ? `<@${topUserId}>` : 'なし',
        inline: true,
      },
      {
        name: '判定',
        value: correct ? '✅ 犯人を当てました！' : '❌ 犯人を逃しました…',
        inline: true,
      }
    );

  if (killer) {
    embed.addFields({ name: '🔪 真の犯人', value: `<@${killer.user_id}> (**${killer.char_name}**)` });
  }

  embed.addFields({ name: '📖 真相', value: scenario.answer });

  db.updateSession(session.id, { status: 'ended', phase: 'reveal' });

  // Send as a follow-up (vote command already replied)
  await interaction.channel.send({ embeds: [embed] });
}

async function showStatus(interaction, session) {
  const scenario = db.getScenario(session.scenario_id);
  const players = db.getPlayers(session.id);
  const revealedClues = db.getRevealedClues(session.id);
  const votes = db.getVotes(session.id);

  const embed = new EmbedBuilder()
    .setTitle(`📋 ゲーム状態：${scenario.title}`)
    .setColor(0x5865f2)
    .addFields(
      { name: 'フェーズ', value: PHASE_LABELS[session.phase] || session.phase, inline: true },
      { name: 'ステータス', value: session.status, inline: true },
      { name: 'GM', value: `<@${session.gm_id}>`, inline: true },
      {
        name: `👥 参加者 (${players.length})`,
        value: players.length > 0 ? players.map((p) => `<@${p.user_id}> → ${p.char_name || '未割当'}`).join('\n') : 'なし',
      },
      {
        name: `🔍 公開済み手がかり (${revealedClues.length})`,
        value: revealedClues.length > 0 ? revealedClues.map((c) => `• ${c.name}`).join('\n') : 'なし',
      },
      {
        name: `🗳️ 投票済み (${votes.length}/${players.length})`,
        value: votes.length > 0 ? votes.map((v) => `<@${v.voter_id}>`).join(', ') : 'なし',
      }
    )
    .setFooter({ text: `セッションID: ${session.id}` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function buildRevealedCluesList(session) {
  const clues = db.getRevealedClues(session.id);
  return clues.map((c) => `• **${c.name}**: ${c.description}`).join('\n');
}

function buildPlayersList(session) {
  const players = db.getPlayers(session.id);
  return players.map((p) => `<@${p.user_id}> (**${p.char_name}**)`).join('\n');
}

module.exports = { moveToPhase, announceClue, revealResults, showStatus };
