package com.tghcgu.powerrecorder

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Detects power button long-press via AccessibilityService key event filtering.
 *
 * Requirements:
 * - flagRequestFilterKeyEvents must be set in accessibility_service_config.xml
 * - User must manually enable this service in Settings > Accessibility
 *
 * Detection strategy:
 * - Record timestamp on ACTION_DOWN
 * - On ACTION_UP, compute elapsed time
 * - If elapsed >= LONG_PRESS_THRESHOLD_MS, toggle recording
 * - Return false to not consume the event (screen still turns on/off normally)
 *
 * Note: On Pixel 9a (Android 15), the system power menu appears at ~700ms.
 * Our 600ms threshold fires before that, and returning true on long press
 * prevents the power menu from showing.
 */
class PowerButtonAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "PowerBtnService"
        private const val LONG_PRESS_THRESHOLD_MS = 600L
        private const val TOGGLE_COOLDOWN_MS = 1000L

        /** Shared state: true while RecordingService is actively recording. */
        @Volatile
        var isRecording: Boolean = false
    }

    private var powerDownTime: Long = 0L
    private var lastToggleTime: Long = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "Service connected — ready to detect power button long-press")
    }

    /**
     * Called for every key event when flagRequestFilterKeyEvents is active.
     *
     * @return true to consume the event (prevents system from processing it),
     *         false to pass it through. We return true only on confirmed long press
     *         to suppress the system power menu while allowing normal short presses.
     */
    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_POWER) return false

        val now = SystemClock.elapsedRealtime()

        return when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                powerDownTime = now
                false // Pass through: let screen turn on/off normally
            }
            KeyEvent.ACTION_UP -> {
                val elapsed = now - powerDownTime
                Log.d(TAG, "Power key up — held for ${elapsed}ms")

                if (elapsed >= LONG_PRESS_THRESHOLD_MS) {
                    val sinceLast = now - lastToggleTime
                    if (sinceLast >= TOGGLE_COOLDOWN_MS) {
                        lastToggleTime = now
                        toggleRecording()
                        true // Consume: suppress the system power menu
                    } else {
                        Log.d(TAG, "Skipped — within cooldown (${sinceLast}ms < ${TOGGLE_COOLDOWN_MS}ms)")
                        false
                    }
                } else {
                    false // Short press: pass through
                }
            }
            else -> false
        }
    }

    private fun toggleRecording() {
        val action: String
        if (isRecording) {
            isRecording = false
            action = RecordingService.ACTION_STOP
            Log.d(TAG, "Long press → STOP recording")
        } else {
            isRecording = true
            action = RecordingService.ACTION_START
            Log.d(TAG, "Long press → START recording")
        }

        val intent = Intent(this, RecordingService::class.java).apply {
            this.action = action
        }
        startForegroundService(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not used — we only care about key events
    }

    override fun onInterrupt() {
        Log.d(TAG, "Service interrupted")
        isRecording = false
    }

    override fun onDestroy() {
        super.onDestroy()
        isRecording = false
    }
}
