package com.example.powerrecorder

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * 電源ボタンの長押しを検出する AccessibilityService。
 *
 * ユーザーが電源ボタンを LONG_PRESS_THRESHOLD_MS 以上押し続けると
 * RecordingService の録音をトグルする。
 *
 * 動作の流れ:
 *   ACTION_DOWN → タイムスタンプ記録
 *   ACTION_UP   → 経過時間が閾値以上なら録音トグル & イベント消費
 */
class PowerButtonService : AccessibilityService() {

    companion object {
        private const val TAG = "PowerButtonService"

        /** 長押し判定の閾値 (ミリ秒) */
        private const val LONG_PRESS_THRESHOLD_MS = 500L
    }

    /** 電源ボタンが押された時刻 */
    private var pressStartTime = 0L

    // -------------------------------------------------------------------------
    // AccessibilityService ライフサイクル
    // -------------------------------------------------------------------------

    override fun onServiceConnected() {
        super.onServiceConnected()
        val info = serviceInfo ?: AccessibilityServiceInfo()
        // キーイベントをフィルタするフラグを追加
        info.flags = info.flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        serviceInfo = info
        Log.i(TAG, "PowerButtonService connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // キーイベント検出のみ使用するため不要
    }

    override fun onInterrupt() {
        Log.w(TAG, "PowerButtonService interrupted")
    }

    // -------------------------------------------------------------------------
    // キーイベント処理
    // -------------------------------------------------------------------------

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_POWER) return false

        return when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                pressStartTime = System.currentTimeMillis()
                false // まだイベントを消費しない (通常の押下は通す)
            }
            KeyEvent.ACTION_UP -> {
                val holdDuration = System.currentTimeMillis() - pressStartTime
                if (holdDuration >= LONG_PRESS_THRESHOLD_MS) {
                    Log.d(TAG, "Power button long press detected: ${holdDuration}ms")
                    toggleRecording()
                    true // イベント消費 → 電源メニューを抑制
                } else {
                    false // 短押しはシステムに通す (画面オン/オフ)
                }
            }
            else -> false
        }
    }

    // -------------------------------------------------------------------------
    // 録音トグル
    // -------------------------------------------------------------------------

    private fun toggleRecording() {
        val intent = Intent(this, RecordingService::class.java)
        if (RecordingService.isRecording) {
            Log.i(TAG, "Stopping recording")
            stopService(intent)
        } else {
            Log.i(TAG, "Starting recording")
            startForegroundService(intent)
        }
    }
}
