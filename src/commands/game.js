const { SlashCommandBuilder } = require('discord.js');
const db = require('../db/database');
const gameManager = require('../game/gameManager');
const phaseController = require('../game/phaseController');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('マーダーミステリーゲームの操作')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('ゲームセッションを作成して参加者を募集する')
        .addIntegerOption((opt) =>
          opt.setName('scenario_id').setDescription('使用するシナリオのID').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('join').setDescription('現在のチャンネルのゲームに参加する')
    )
    .addSubcommand((sub) =>
      sub.setName('begin').setDescription('【GM専用】参加者への役割配布とゲーム開始')
    )
    .addSubcommand((sub) =>
      sub
        .setName('phase')
        .setDescription('【GM専用】ゲームフェーズを進める')
        .addStringOption((opt) =>
          opt
            .setName('next')
            .setDescription('次のフェーズ')
            .setRequired(true)
            .addChoices(
              { name: '調査フェーズへ', value: 'investigation' },
              { name: '議論フェーズへ', value: 'discussion' },
              { name: '投票フェーズへ', value: 'voting' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('investigate')
        .setDescription('手がかりを調査して全員に公開する')
        .addIntegerOption((opt) =>
          opt.setName('clue_id').setDescription('手がかりID（/scenario view で確認）').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('vote')
        .setDescription('犯人だと思う人物に投票する')
        .addUserOption((opt) =>
          opt.setName('player').setDescription('投票する対象のプレイヤー').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('現在のゲーム状態を表示する')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const scenarioId = interaction.options.getInteger('scenario_id');
      const scenario = db.getScenario(scenarioId);
      if (!scenario) {
        return interaction.reply({ content: `シナリオID ${scenarioId} は存在しません。`, ephemeral: true });
      }

      const existing = db.getActiveSession(interaction.channelId);
      if (existing) {
        return interaction.reply({
          content: `このチャンネルには既に進行中のゲーム（ID:${existing.id}）があります。`,
          ephemeral: true,
        });
      }

      const characters = db.getCharacters(scenarioId);
      if (characters.length < 2) {
        return interaction.reply({
          content: 'このシナリオにはキャラクターが最低2人必要です。`/scenario add-character` で追加してください。',
          ephemeral: true,
        });
      }

      const sessionId = db.createSession({
        scenario_id: scenarioId,
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
        gm_id: interaction.user.id,
      });

      await gameManager.sendRecruitEmbed(interaction, sessionId, scenario, characters.length);
      return;
    }

    if (sub === 'join') {
      const session = db.getActiveSession(interaction.channelId);
      if (!session) {
        return interaction.reply({ content: 'このチャンネルに募集中のゲームはありません。', ephemeral: true });
      }
      if (session.status !== 'waiting') {
        return interaction.reply({ content: 'ゲームは既に開始されています。', ephemeral: true });
      }
      if (db.isPlayerInSession(session.id, interaction.user.id)) {
        return interaction.reply({ content: '既に参加登録済みです。', ephemeral: true });
      }

      db.addPlayer({ session_id: session.id, user_id: interaction.user.id, character_id: 0 });
      return interaction.reply({
        content: `✅ <@${interaction.user.id}> が参加登録しました！`,
      });
    }

    if (sub === 'begin') {
      const session = db.getActiveSession(interaction.channelId);
      if (!session) {
        return interaction.reply({ content: 'このチャンネルに進行中のゲームはありません。', ephemeral: true });
      }
      if (session.gm_id !== interaction.user.id) {
        return interaction.reply({ content: 'このコマンドはGMのみ使用できます。', ephemeral: true });
      }
      if (session.status !== 'waiting') {
        return interaction.reply({ content: 'ゲームは既に開始されています。', ephemeral: true });
      }

      await interaction.deferReply();
      await gameManager.beginGame(interaction, session);
      return;
    }

    if (sub === 'phase') {
      const session = db.getActiveSession(interaction.channelId);
      if (!session) {
        return interaction.reply({ content: 'このチャンネルに進行中のゲームはありません。', ephemeral: true });
      }
      if (session.gm_id !== interaction.user.id) {
        return interaction.reply({ content: 'このコマンドはGMのみ使用できます。', ephemeral: true });
      }

      const nextPhase = interaction.options.getString('next');
      await phaseController.moveToPhase(interaction, session, nextPhase);
      return;
    }

    if (sub === 'investigate') {
      const session = db.getActiveSession(interaction.channelId);
      if (!session) {
        return interaction.reply({ content: 'このチャンネルに進行中のゲームはありません。', ephemeral: true });
      }
      if (session.phase !== 'investigation') {
        return interaction.reply({ content: '現在は調査フェーズではありません。', ephemeral: true });
      }
      if (!db.isPlayerInSession(session.id, interaction.user.id)) {
        return interaction.reply({ content: 'あなたはこのゲームの参加者ではありません。', ephemeral: true });
      }

      const clueId = interaction.options.getInteger('clue_id');
      const clue = db.getClue(clueId);
      if (!clue || clue.scenario_id !== session.scenario_id) {
        return interaction.reply({ content: `手がかりID ${clueId} はこのシナリオに存在しません。`, ephemeral: true });
      }

      const revealed = db.revealClue(session.id, clueId);
      if (!revealed) {
        return interaction.reply({ content: 'この手がかりは既に公開されています。', ephemeral: true });
      }

      await phaseController.announceClue(interaction, clue);
      return;
    }

    if (sub === 'vote') {
      const session = db.getActiveSession(interaction.channelId);
      if (!session) {
        return interaction.reply({ content: 'このチャンネルに進行中のゲームはありません。', ephemeral: true });
      }
      if (session.phase !== 'voting') {
        return interaction.reply({ content: '現在は投票フェーズではありません。', ephemeral: true });
      }
      if (!db.isPlayerInSession(session.id, interaction.user.id)) {
        return interaction.reply({ content: 'あなたはこのゲームの参加者ではありません。', ephemeral: true });
      }

      const target = interaction.options.getUser('player');
      if (!db.isPlayerInSession(session.id, target.id)) {
        return interaction.reply({ content: `<@${target.id}> はこのゲームの参加者ではありません。`, ephemeral: true });
      }

      db.addVote({ session_id: session.id, voter_id: interaction.user.id, target_id: target.id });
      await interaction.reply({ content: `🗳️ <@${interaction.user.id}> が投票しました。` });

      // Check if all players have voted
      const players = db.getPlayers(session.id);
      const votes = db.getVotes(session.id);
      if (votes.length >= players.length) {
        await phaseController.revealResults(interaction, session);
      }
      return;
    }

    if (sub === 'status') {
      const session = db.getActiveSession(interaction.channelId);
      if (!session) {
        return interaction.reply({ content: 'このチャンネルに進行中のゲームはありません。', ephemeral: true });
      }

      await phaseController.showStatus(interaction, session);
      return;
    }
  },
};
