const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db/database');

// フェーズタイプの日本語表示
const TYPE_LABELS = {
  manual:              '手動（GM操作）',
  clues_investigated:  '手がかり調査',
  all_players_ready:   '全員準備完了',
  vote:                '投票',
};

// フェーズタイプの説明
function getConditionText(phase) {
  switch (phase.type) {
    case 'manual':             return 'GMが `/game phase next` を実行すると次へ進みます。';
    case 'clues_investigated': return `手がかりを **${phase.condition_value}個** 調査すると次へ進めます。`;
    case 'all_players_ready':  return '全員がボタンで「準備完了」を押すと自動的に次へ進みます。';
    case 'vote':               return `全員が投票し、**${phase.condition_value}%以上** の得票があれば次へ進みます。\n過半数未達の場合はフェーズ ${phase.on_fail_phase_index ?? '—'} に戻ります。`;
    default:                   return '';
  }
}

/**
 * 現在のフェーズオブジェクトを返す
 */
function getCurrentPhase(session) {
  const phases = db.getPhases(session.scenario_id);
  return phases[session.phase_index] ?? null;
}

/**
 * フェーズ開始 Embed を送信する
 */
async function announcePhase(channel, session) {
  const phases = db.getPhases(session.scenario_id);
  const phase = phases[session.phase_index];
  if (!phase) return;

  const isLast = session.phase_index >= phases.length - 1;

  const colorMap = {
    manual:             0x5865f2,
    clues_investigated: 0x57f287,
    all_players_ready:  0xfee75c,
    vote:               0xed4245,
  };

  const embed = new EmbedBuilder()
    .setTitle(`📍 フェーズ ${session.phase_index + 1}/${phases.length}：${phase.name}`)
    .setColor(colorMap[phase.type] ?? 0x5865f2)
    .setDescription(phase.description)
    .addFields(
      { name: '進行条件', value: getConditionText(phase) },
      { name: 'フェーズ一覧', value: phases.map((p, i) => `${i === session.phase_index ? '▶' : '　'} **${p.name}** (${TYPE_LABELS[p.type] ?? p.type})`).join('\n') }
    );

  const components = [];

  // all_players_ready の場合: 「準備完了」ボタンを表示
  if (phase.type === 'all_players_ready') {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ready_${session.id}_${session.phase_index}`)
          .setLabel('✅ 準備完了')
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  await channel.send({ embeds: [embed], components });
}

/**
 * GMが手動でフェーズを進めようとしたとき（/game phase next）
 */
async function tryAdvancePhase(interaction, session) {
  const phases = db.getPhases(session.scenario_id);
  const phase = phases[session.phase_index];
  if (!phase) {
    return interaction.reply({ content: 'フェーズ情報が見つかりません。', ephemeral: true });
  }

  // clues_investigated: 条件チェック
  if (phase.type === 'clues_investigated') {
    const revealed = db.getRevealedClues(session.id);
    if (revealed.length < phase.condition_value) {
      return interaction.reply({
        content: `まだ手がかりが足りません。**${revealed.length}/${phase.condition_value}個** 調査済みです。`,
        ephemeral: true,
      });
    }
  }

  // all_players_ready: 全員チェック
  if (phase.type === 'all_players_ready') {
    const players = db.getPlayers(session.id);
    const ready = db.getReadyPlayers(session.id, session.phase_index);
    if (ready.length < players.length) {
      return interaction.reply({
        content: `まだ全員が準備完了していません。**${ready.length}/${players.length}人** 完了済みです。`,
        ephemeral: true,
      });
    }
  }

  // vote: GMは投票フェーズをスキップできない
  if (phase.type === 'vote') {
    return interaction.reply({ content: '投票フェーズは全員の投票完了後に自動で進みます。', ephemeral: true });
  }

  await interaction.deferReply();
  await advanceToNext(interaction.channel, session, phases);
  await interaction.deleteReply();
}

/**
 * 次フェーズへ進む（または ゲーム終了）
 */
async function advanceToNext(channel, session, phases) {
  const nextIndex = session.phase_index + 1;

  if (nextIndex >= phases.length) {
    // ゲーム終了 → 真相公開
    db.updateSession(session.id, { status: 'ended', phase_index: nextIndex });
    await revealTruth(channel, session);
    return;
  }

  db.updateSession(session.id, { phase_index: nextIndex });
  const updatedSession = db.getSession(session.id);
  await announcePhase(channel, updatedSession);
}

/**
 * 手がかり公開
 */
async function announceClue(interaction, clue) {
  const revealed = db.getRevealedClues(interaction.client._activeSession?.id ?? 0);
  const embed = new EmbedBuilder()
    .setTitle(`🔍 手がかり発見：${clue.name}`)
    .setColor(0x57f287)
    .setDescription(clue.description)
    .setFooter({ text: `手がかりID: ${clue.id}` });

  await interaction.reply({ embeds: [embed] });
}

/**
 * 手がかり調査後、条件チェックして自動進行するか確認
 */
async function checkClueCondition(channel, session) {
  const phases = db.getPhases(session.scenario_id);
  const phase = phases[session.phase_index];
  if (!phase || phase.type !== 'clues_investigated') return;

  const revealed = db.getRevealedClues(session.id);
  if (revealed.length >= phase.condition_value) {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setDescription(`✅ 手がかりを **${revealed.length}個** 調査しました。GMは \`/game phase next\` で次のフェーズに進められます。`);
    await channel.send({ embeds: [embed] });
  }
}

/**
 * 「準備完了」ボタン押下処理
 */
async function handleReadyButton(interaction, sessionId, phaseIndex) {
  const session = db.getSession(sessionId);
  if (!session || session.phase_index !== phaseIndex) {
    return interaction.reply({ content: 'このフェーズはすでに終了しています。', ephemeral: true });
  }
  if (!db.isPlayerInSession(sessionId, interaction.user.id)) {
    return interaction.reply({ content: 'あなたはこのゲームの参加者ではありません。', ephemeral: true });
  }

  const added = db.setReady(sessionId, phaseIndex, interaction.user.id);
  if (!added) {
    return interaction.reply({ content: '既に準備完了済みです。', ephemeral: true });
  }

  const players = db.getPlayers(sessionId);
  const ready = db.getReadyPlayers(sessionId, phaseIndex);
  await interaction.reply({ content: `✅ <@${interaction.user.id}> が準備完了！（${ready.length}/${players.length}人）` });

  // 全員揃ったら自動進行
  if (ready.length >= players.length) {
    const phases = db.getPhases(session.scenario_id);
    await interaction.channel.send({ content: '全員が準備完了しました！次のフェーズへ進みます...' });
    await advanceToNext(interaction.channel, session, phases);
  }
}

/**
 * 投票処理 + 結果判定
 */
async function handleVote(interaction, session, targetUser) {
  const phases = db.getPhases(session.scenario_id);
  const phase = phases[session.phase_index];

  db.addVote({ session_id: session.id, phase_index: session.phase_index, voter_id: interaction.user.id, target_id: targetUser.id });
  await interaction.reply({ content: `🗳️ <@${interaction.user.id}> が投票しました。` });

  const players = db.getPlayers(session.id);
  const votes = db.getVotes(session.id, session.phase_index);

  if (votes.length < players.length) return; // まだ全員投票していない

  // 集計
  const tally = {};
  for (const v of votes) tally[v.target_id] = (tally[v.target_id] || 0) + 1;
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const [topUserId, topCount] = sorted[0] ?? ['', 0];
  const threshold = phase?.condition_value ?? 51;
  const majorityPct = Math.round((topCount / players.length) * 100);
  const hasMajority = majorityPct >= threshold;

  // 投票サマリー Embed
  const voteSummary = sorted.map(([uid, cnt]) => {
    const p = players.find((pl) => pl.user_id === uid);
    const pct = Math.round((cnt / players.length) * 100);
    return `<@${uid}> (${p?.char_name ?? '?'}) — **${cnt}票 (${pct}%)**`;
  });

  const summaryEmbed = new EmbedBuilder()
    .setTitle('📊 投票結果')
    .setColor(hasMajority ? 0x57f287 : 0xfee75c)
    .addFields({ name: '得票数', value: voteSummary.join('\n') || 'なし' });

  if (!hasMajority && phase?.on_fail_phase_index != null) {
    summaryEmbed
      .setDescription(`⚠️ 最多得票 ${majorityPct}% は閾値 ${threshold}% 未達です。フェーズ「${phases[phase.on_fail_phase_index]?.name ?? '?'}」に戻ります。`)
      .setColor(0xed4245);
    await interaction.channel.send({ embeds: [summaryEmbed] });

    // 指定フェーズに戻る
    db.updateSession(session.id, { phase_index: phase.on_fail_phase_index });
    const updatedSession = db.getSession(session.id);
    await announcePhase(interaction.channel, updatedSession);
  } else {
    await interaction.channel.send({ embeds: [summaryEmbed] });
    await advanceToNext(interaction.channel, session, phases);
  }
}

/**
 * 真相公開
 */
async function revealTruth(channel, session) {
  const scenario = db.getScenario(session.scenario_id);
  const players = db.getPlayers(session.id);
  const killer = players.find((p) => p.is_killer);

  const embed = new EmbedBuilder()
    .setTitle('🎭 真相公開')
    .setColor(0x5865f2)
    .addFields(
      { name: '🔪 真の犯人', value: killer ? `<@${killer.user_id}> (**${killer.char_name}**)` : '（設定なし）' },
      { name: '📖 真相', value: scenario.answer }
    )
    .setFooter({ text: 'ゲーム終了' });

  await channel.send({ embeds: [embed] });
}

/**
 * ゲーム状態表示
 */
async function showStatus(interaction, session) {
  const scenario = db.getScenario(session.scenario_id);
  const phases = db.getPhases(session.scenario_id);
  const players = db.getPlayers(session.id);
  const revealedClues = db.getRevealedClues(session.id);
  const phase = phases[session.phase_index];
  const votes = phase?.type === 'vote' ? db.getVotes(session.id, session.phase_index) : [];
  const ready = phase?.type === 'all_players_ready' ? db.getReadyPlayers(session.id, session.phase_index) : [];

  const embed = new EmbedBuilder()
    .setTitle(`📋 ゲーム状態：${scenario.title}`)
    .setColor(0x5865f2)
    .addFields(
      { name: '現在のフェーズ', value: phase ? `**${phase.name}** (${session.phase_index + 1}/${phases.length})` : 'ゲーム終了', inline: true },
      { name: '条件', value: phase ? TYPE_LABELS[phase.type] ?? phase.type : '—', inline: true },
      { name: 'GM', value: `<@${session.gm_id}>`, inline: true },
      {
        name: `👥 参加者 (${players.length})`,
        value: players.length > 0 ? players.map((p) => `<@${p.user_id}> → ${p.char_name || '未割当'}`).join('\n') : 'なし',
      },
      {
        name: `🔍 公開済み手がかり (${revealedClues.length})`,
        value: revealedClues.length > 0 ? revealedClues.map((c) => `• ${c.name}`).join('\n') : 'なし',
      }
    );

  if (phase?.type === 'vote' && votes.length > 0) {
    embed.addFields({ name: `🗳️ 投票済み (${votes.length}/${players.length})`, value: votes.map((v) => `<@${v.voter_id}>`).join(', ') });
  }
  if (phase?.type === 'all_players_ready' && ready.length > 0) {
    embed.addFields({ name: `✅ 準備完了 (${ready.length}/${players.length})`, value: ready.map((r) => `<@${r.user_id}>`).join(', ') });
  }

  embed.addFields({
    name: '🗺️ 全フェーズ',
    value: phases.map((p, i) => {
      const marker = i < session.phase_index ? '✅' : i === session.phase_index ? '▶' : '⬜';
      return `${marker} **${p.name}** — ${TYPE_LABELS[p.type] ?? p.type}`;
    }).join('\n'),
  });

  embed.setFooter({ text: `セッションID: ${session.id}` });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  getCurrentPhase,
  announcePhase,
  tryAdvancePhase,
  announceClue,
  checkClueCondition,
  handleReadyButton,
  handleVote,
  revealTruth,
  showStatus,
};
