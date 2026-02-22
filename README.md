# Google Calendar to CSV (for フリカレ)

Googleカレンダーの予定をCSVに出力するツールです。
フリカレ（フリーカレンダー）への手動入力時の参照データとして使えます。

## セットアップ

### 1. Google Cloud の設定

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを作成（または既存のものを選択）
3. 「APIとサービス」→「ライブラリ」で **Google Calendar API** を有効化
4. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
5. アプリケーションの種類を「デスクトップアプリ」に設定
6. JSONをダウンロードし、`credentials.json` としてこのディレクトリに保存

### 2. Python の依存関係をインストール

```bash
pip install -r requirements.txt
```

## 使い方

### 基本（今月の予定を出力）

```bash
python gcal_to_csv.py
```

### 期間を指定

```bash
python gcal_to_csv.py --start 2026-02-01 --end 2026-02-28
```

### カレンダー一覧を確認

```bash
python gcal_to_csv.py --list-calendars
```

### 特定のカレンダーを指定

```bash
python gcal_to_csv.py --calendar "your_calendar_id@group.calendar.google.com"
```

### 出力ファイル名を指定

```bash
python gcal_to_csv.py --output my_schedule.csv
```

## 出力CSV形式

| 列 | 説明 |
|---|---|
| 日付 | 開始日 (YYYY-MM-DD) |
| 開始時刻 | 開始時刻 (HH:MM)、終日イベントは空 |
| 終了日 | 終了日 (YYYY-MM-DD) |
| 終了時刻 | 終了時刻 (HH:MM)、終日イベントは空 |
| 終日 | 終日イベントの場合「○」 |
| タイトル | イベント名 |
| 場所 | 場所 |
| 説明 | イベントの説明 |

初回実行時にブラウザが開き、Googleアカウントでの認証が求められます。
認証後は `token.json` が保存され、次回以降は自動で認証されます。
