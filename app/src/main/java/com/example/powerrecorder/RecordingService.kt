package com.example.powerrecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.MediaRecorder
import android.os.Environment
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 音声録音を担当する ForegroundService。
 *
 * - 起動時に MediaRecorder で録音を開始し、通知バーに録音中インジケータを表示する。
 * - stopService() または通知の「停止」ボタンで録音を終了しファイルを保存する。
 * - 録音ファイルは Music/PowerRecorder/ フォルダに m4a 形式で保存される。
 */
class RecordingService : Service() {

    companion object {
        private const val TAG = "RecordingService"
        private const val CHANNEL_ID = "power_recorder_channel"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "com.example.powerrecorder.ACTION_STOP"

        /** PowerButtonService から録音状態を参照するためのフラグ */
        @Volatile
        var isRecording = false
    }

    private var mediaRecorder: MediaRecorder? = null
    private var currentFilePath: String? = null

    // -------------------------------------------------------------------------
    // Service ライフサイクル
    // -------------------------------------------------------------------------

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, buildNotification())
        startRecording()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopRecording()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // -------------------------------------------------------------------------
    // 録音制御
    // -------------------------------------------------------------------------

    private fun startRecording() {
        if (isRecording) return

        val outputDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
            "PowerRecorder"
        )
        if (!outputDir.exists()) outputDir.mkdirs()

        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val outputFile = File(outputDir, "REC_$timestamp.m4a")
        currentFilePath = outputFile.absolutePath

        try {
            @Suppress("DEPRECATION")
            mediaRecorder = MediaRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128_000)
                setAudioSamplingRate(44_100)
                setOutputFile(currentFilePath)
                prepare()
                start()
            }
            isRecording = true
            Log.i(TAG, "Recording started: $currentFilePath")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start recording", e)
            releaseRecorder()
            stopSelf()
        }
    }

    private fun stopRecording() {
        if (!isRecording) return
        try {
            mediaRecorder?.apply {
                stop()
                reset()
            }
            Log.i(TAG, "Recording saved: $currentFilePath")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping recorder", e)
        } finally {
            releaseRecorder()
        }
    }

    private fun releaseRecorder() {
        mediaRecorder?.release()
        mediaRecorder = null
        isRecording = false
    }

    // -------------------------------------------------------------------------
    // 通知
    // -------------------------------------------------------------------------

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.notification_channel_desc)
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, RecordingService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_recording_title))
            .setContentText(getString(R.string.notification_recording_text))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(openAppIntent)
            .addAction(
                android.R.drawable.ic_media_pause,
                getString(R.string.notification_stop_action),
                stopPendingIntent
            )
            .build()
    }
}
