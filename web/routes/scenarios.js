const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('../../src/db/database');

// GET /scenarios — list page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

// GET /scenarios/create — creation form
router.get('/create', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/create.html'));
});

// GET /scenarios/:id — detail page
router.get('/:id(\\d+)', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/view.html'));
});

// ── JSON API ────────────────────────────────────────────────────────────────

// GET /scenarios/api/list
router.get('/api/list', (req, res) => {
  const scenarios = db.listScenarios();
  const result = scenarios.map((s) => {
    const characters = db.getCharacters(s.id);
    const clues = db.getClues(s.id);
    const phases = db.getPhases(s.id);
    return { ...s, character_count: characters.length, clue_count: clues.length, phase_count: phases.length };
  });
  res.json(result);
});

// GET /scenarios/api/:id
router.get('/api/:id(\\d+)', (req, res) => {
  const scenario = db.getScenario(Number(req.params.id));
  if (!scenario) return res.status(404).json({ error: 'Not found' });
  const characters = db.getCharacters(scenario.id);
  const clues = db.getClues(scenario.id);
  const phases = db.getPhases(scenario.id);
  res.json({ ...scenario, characters, clues, phases });
});

// POST /scenarios/api — create scenario with characters, clues, phases
router.post('/api', (req, res) => {
  const { title, overview, answer, characters = [], clues = [], phases = [] } = req.body;

  if (!title || !overview || !answer) {
    return res.status(400).json({ error: 'title, overview, answer は必須です' });
  }
  if (characters.length < 2) {
    return res.status(400).json({ error: 'キャラクターは最低2人必要です' });
  }
  if (!characters.some((c) => c.is_killer)) {
    return res.status(400).json({ error: '犯人キャラクターを1人指定してください' });
  }

  const scenarioId = db.createScenario({
    guild_id: 'web',
    creator_id: 'web',
    title,
    overview,
    answer,
  });

  for (const char of characters) {
    db.addCharacter({
      scenario_id: scenarioId,
      name: char.name,
      description: char.description,
      secret: char.secret,
      is_killer: char.is_killer ? 1 : 0,
    });
  }

  for (const clue of clues) {
    db.addClue({ scenario_id: scenarioId, name: clue.name, description: clue.description });
  }

  // フェーズが指定されていない場合はデフォルト（DBに保存しない = DEFAULT_PHASESを使用）
  if (phases.length > 0) {
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      db.addPhase({
        scenario_id: scenarioId,
        order_index: i,
        name: p.name,
        description: p.description,
        type: p.type || 'manual',
        condition_value: Number(p.condition_value) || 0,
        on_fail_phase_index: p.on_fail_phase_index != null ? Number(p.on_fail_phase_index) : null,
      });
    }
  }

  res.json({ id: scenarioId });
});

// DELETE /scenarios/api/:id
router.delete('/api/:id(\\d+)', (req, res) => {
  db.deleteScenario(Number(req.params.id), 'web');
  res.json({ ok: true });
});

module.exports = router;
