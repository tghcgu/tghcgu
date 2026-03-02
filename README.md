# Power Button Recorder — Pixel 9a

電源ボタン長押しするだけで録音を開始・停止できる Android アプリ。

## 概要

Pixel 9a（Android 14+）向けの音声レコーダーです。
ホーム画面やロック画面を操作することなく、**電源ボタンを 0.6 秒以上長押しするだけ**で録音を開始できます。

```
電源ボタン長押し (0.6秒+) → 録音開始
電源ボタン長押し (0.6秒+) → 録音停止
```

## 仕組み

| コンポーネント | 役割 |
|---|---|
| `AccessibilityService` | 電源ボタンのキーイベントを監視し、長押しを検出 |
| `RecordingService` | `FOREGROUND_SERVICE_MICROPHONE` 型のフォアグラウンドサービスで録音管理 |
| `MediaRecorder` | AAC/M4A 形式で録音（44.1kHz, 128kbps, モノラル） |

### 電源ボタン検出の仕組み

`AccessibilityService` に `flagRequestFilterKeyEvents` フラグを設定することで、
`onKeyEvent()` コールバックで `KEYCODE_POWER` イベントを受信します。

- `ACTION_DOWN` でタイムスタンプを記録
- `ACTION_UP` で経過時間を計算
- **600ms 以上**なら長押しと判定 → 録音トグル
- イベントを消費（`return true`）して電源メニューの表示を抑制

## セットアップ

### 必要な権限

- **マイク権限** — `RECORD_AUDIO`（ランタイム権限）
- **通知権限** — `POST_NOTIFICATIONS`（Android 13+）
- **アクセシビリティサービス** — 設定から手動で有効化が必要

### 手順

1. アプリをインストールして起動
2. 「権限を許可する」ボタンでマイク・通知権限を付与
3. 「アクセシビリティ設定を開く」→ 「Power Button Recorder」をオン
4. アプリに戻ると「準備完了」と表示される

## 録音ファイル

保存先: `Android/data/com.tghcgu.powerrecorder/files/Recordings/`
形式: `REC_yyyyMMdd_HHmmss.m4a`

## ビルド方法

```bash
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

**要件:**
- Android Studio Hedgehog 以降
- Android SDK 34+（Pixel 9a 対象）
- JDK 17

## 注意事項

- **root 不要** — アクセシビリティサービスのみ使用
- アクセシビリティサービスは設定画面からの手動有効化が必須（Android のセキュリティ仕様）
- 録音中はステータスバーにマイクアイコン（緑）が表示される（Android 12+ の仕様）
- バッテリー最適化の除外を推奨（設定 > バッテリー > バッテリーの最適化 > 最適化しない）
