# 🔪 Discord マーダーミステリーBot

Discordで完結するマーダーミステリーゲームBot。誰でもシナリオを投稿でき、Discordサーバー上でゲームを楽しめます。

## 特徴

- **完全Discord完結** — ゲーム進行はすべてSlashコマンドで操作
- **ブラウザからシナリオ作成** — `http://localhost:3000` のWebUIでかんたんに作成可能
- **誰でもシナリオ投稿** — Discordコマンドでも作成可能
- **自動役職配布** — ゲーム開始時にランダムでキャラクターをDM送信
- **投票システム** — 全員投票完了で自動集計・真相公開

## セットアップ

### 1. Botを作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot タブで Token をコピー
3. OAuth2 > URL Generator で `bot` + `applications.commands` スコープを選択し、Botをサーバーに招待

### 2. インストール

```bash
npm install
cp .env.example .env
# .env を編集して DISCORD_TOKEN と CLIENT_ID を設定
```

### 3. Slash Command を登録

```bash
npm run deploy
```

### 4. 起動

```bash
npm start
```

Bot が起動すると同時に `http://localhost:3000` でWebUIも起動します。

---

## 使い方

### シナリオ作成（ブラウザ推奨）

1. `http://localhost:3000/scenarios/create` を開く
2. タイトル・概要・真相を入力
3. キャラクターを追加（最低2人・犯人1人必須）
4. 手がかりを追加（任意）
5. 保存 → **シナリオID** が発行される

### シナリオ作成（Discord）

```
/scenario create
/scenario add-character scenario_id:1
/scenario add-clue scenario_id:1
/scenario list
```

### ゲーム進行

```
# GM がゲームを開始・参加者を募集
/game start scenario_id:1

# プレイヤーが参加（ボタンまたはコマンド）
/game join

# GM がゲームを本開始（役職をDMで配布）
/game begin

# 調査フェーズへ移行
/game phase next:調査フェーズへ

# 手がかりを調査（チャンネルに公開）
/game investigate clue_id:1

# 議論フェーズへ移行
/game phase next:議論フェーズへ

# 投票フェーズへ移行
/game phase next:投票フェーズへ

# 犯人に投票
/game vote player:@PlayerName

# 全員投票完了 → 自動で真相公開

# 現在の状態を確認
/game status
```

---

## ゲームフロー

```
募集 → 参加 → ゲーム開始（役職配布） → 調査 → 議論 → 投票 → 真相公開
```

---

## ファイル構成

```
src/
├── index.js              # Botエントリポイント
├── deploy-commands.js    # Slashコマンド登録
├── db/database.js        # SQLite操作
├── commands/
│   ├── scenario.js       # /scenario コマンド
│   └── game.js           # /game コマンド
├── handlers/
│   ├── commandHandler.js
│   ├── modalHandler.js
│   └── buttonHandler.js
└── game/
    ├── gameManager.js    # ゲームセッション管理
    └── phaseController.js # フェーズ制御

web/
├── server.js             # Express WebUI
├── routes/scenarios.js   # シナリオAPI
└── views/                # HTML
```
