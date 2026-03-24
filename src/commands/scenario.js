const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const db = require('../db/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scenario')
    .setDescription('シナリオ管理')
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('新しいシナリオを作成する（基本情報）')
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-character')
        .setDescription('シナリオにキャラクターを追加する')
        .addIntegerOption((opt) =>
          opt.setName('scenario_id').setDescription('シナリオID').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-clue')
        .setDescription('シナリオに手がかりを追加する')
        .addIntegerOption((opt) =>
          opt.setName('scenario_id').setDescription('シナリオID').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('シナリオ一覧を表示する')
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('シナリオの詳細を表示する')
        .addIntegerOption((opt) =>
          opt.setName('scenario_id').setDescription('シナリオID').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('自分のシナリオを削除する')
        .addIntegerOption((opt) =>
          opt.setName('scenario_id').setDescription('シナリオID').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const modal = new ModalBuilder()
        .setCustomId('scenario_create')
        .setTitle('シナリオ作成 — 基本情報');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('タイトル')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('overview')
            .setLabel('事件の概要（全員に公開）')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('answer')
            .setLabel('真相（ゲーム終了後に公開）')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (sub === 'add-character') {
      const scenarioId = interaction.options.getInteger('scenario_id');
      const scenario = db.getScenario(scenarioId);
      if (!scenario) {
        return interaction.reply({ content: `シナリオID ${scenarioId} は存在しません。`, ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`scenario_add_character_${scenarioId}`)
        .setTitle('キャラクター追加');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('キャラクター名')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('公開プロフィール（全員に見える）')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('secret')
            .setLabel('秘密情報（本人のみDMで受け取る）')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('is_killer')
            .setLabel('犯人ですか？ (yes / no)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(3)
            .setPlaceholder('yes または no')
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (sub === 'add-clue') {
      const scenarioId = interaction.options.getInteger('scenario_id');
      const scenario = db.getScenario(scenarioId);
      if (!scenario) {
        return interaction.reply({ content: `シナリオID ${scenarioId} は存在しません。`, ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`scenario_add_clue_${scenarioId}`)
        .setTitle('手がかり追加');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('手がかりの名前')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('調査結果（全員に公開）')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(800)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (sub === 'list') {
      const scenarios = db.listScenarios(interaction.guildId);
      if (scenarios.length === 0) {
        return interaction.reply({ content: 'まだシナリオがありません。`/scenario create` で作成しましょう！', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('📚 シナリオ一覧')
        .setColor(0x5865f2)
        .setDescription(
          scenarios
            .map((s) => {
              const chars = db.getCharacters(s.id);
              const clues = db.getClues(s.id);
              return `**[ID:${s.id}] ${s.title}**\n👥 ${chars.length}人 ／ 🔍 手がかり${clues.length}個`;
            })
            .join('\n\n')
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'view') {
      const scenarioId = interaction.options.getInteger('scenario_id');
      const scenario = db.getScenario(scenarioId);
      if (!scenario) {
        return interaction.reply({ content: `シナリオID ${scenarioId} は存在しません。`, ephemeral: true });
      }

      const characters = db.getCharacters(scenarioId);
      const clues = db.getClues(scenarioId);

      const embed = new EmbedBuilder()
        .setTitle(`🔪 ${scenario.title}`)
        .setColor(0x5865f2)
        .addFields(
          { name: '📖 概要', value: scenario.overview },
          {
            name: '👥 キャラクター',
            value:
              characters.length > 0
                ? characters.map((c) => `• **${c.name}** ${c.is_killer ? '🔪' : ''}`).join('\n')
                : 'なし',
          },
          {
            name: '🔍 手がかり',
            value:
              clues.length > 0
                ? clues.map((c) => `• [#${c.id}] ${c.name}`).join('\n')
                : 'なし',
          },
          { name: 'ID', value: String(scenarioId), inline: true },
          { name: '作成日', value: scenario.created_at, inline: true }
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'delete') {
      const scenarioId = interaction.options.getInteger('scenario_id');
      const result = db.deleteScenario(scenarioId, interaction.user.id);
      if (result.changes === 0) {
        return interaction.reply({
          content: 'シナリオが見つからないか、削除権限がありません。',
          ephemeral: true,
        });
      }
      return interaction.reply({ content: `シナリオID ${scenarioId} を削除しました。`, ephemeral: true });
    }
  },
};
