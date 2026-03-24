const { EmbedBuilder } = require('discord.js');
const db = require('../db/database');

async function handleModal(interaction) {
  const { customId } = interaction;

  // ── シナリオ作成 ────────────────────────────────────────────────────────
  if (customId === 'scenario_create') {
    const title = interaction.fields.getTextInputValue('title').trim();
    const overview = interaction.fields.getTextInputValue('overview').trim();
    const answer = interaction.fields.getTextInputValue('answer').trim();

    const scenarioId = db.createScenario({
      guild_id: interaction.guildId,
      creator_id: interaction.user.id,
      title,
      overview,
      answer,
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ シナリオを作成しました')
      .setColor(0x57f287)
      .addFields(
        { name: 'シナリオID', value: String(scenarioId), inline: true },
        { name: 'タイトル', value: title },
        { name: '次のステップ', value: `\`/scenario add-character scenario_id:${scenarioId}\` でキャラクターを追加\n\`/scenario add-clue scenario_id:${scenarioId}\` で手がかりを追加` }
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── キャラクター追加 ────────────────────────────────────────────────────
  if (customId.startsWith('scenario_add_character_')) {
    const scenarioId = Number(customId.replace('scenario_add_character_', ''));
    const name = interaction.fields.getTextInputValue('name').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const secret = interaction.fields.getTextInputValue('secret').trim();
    const killerInput = interaction.fields.getTextInputValue('is_killer').trim().toLowerCase();
    const isKiller = killerInput === 'yes' || killerInput === 'はい' || killerInput === 'y';

    const charId = db.addCharacter({ scenario_id: scenarioId, name, description, secret, is_killer: isKiller });

    const embed = new EmbedBuilder()
      .setTitle(`✅ キャラクターを追加しました${isKiller ? ' 🔪' : ''}`)
      .setColor(0x57f287)
      .addFields(
        { name: '名前', value: name, inline: true },
        { name: '犯人', value: isKiller ? 'はい' : 'いいえ', inline: true },
        { name: '公開プロフィール', value: description },
        { name: '秘密情報', value: secret }
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── 手がかり追加 ────────────────────────────────────────────────────────
  if (customId.startsWith('scenario_add_clue_')) {
    const scenarioId = Number(customId.replace('scenario_add_clue_', ''));
    const name = interaction.fields.getTextInputValue('name').trim();
    const description = interaction.fields.getTextInputValue('description').trim();

    const clueId = db.addClue({ scenario_id: scenarioId, name, description });

    const embed = new EmbedBuilder()
      .setTitle('✅ 手がかりを追加しました')
      .setColor(0x57f287)
      .addFields(
        { name: '手がかりID', value: String(clueId), inline: true },
        { name: '名前', value: name },
        { name: '調査結果', value: description }
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = { handleModal };
