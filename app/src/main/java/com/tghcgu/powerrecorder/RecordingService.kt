package com.tghcgu.powerrecorder

import android.app.Service
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Foreground service that manages MediaRecorder lifecycle.
 *
 * Android 14+ requirements:
 * - foregroundServiceType="microphone" in AndroidManifest.xml
 * - FOREGROUND_SERVICE_MICROPHONE permission declared
 * - startForeground() called within 5 seconds of startForegroundService()
 * - RECORD_AUDIO permission must be granted before starting
 */
class RecordingService : Service() {

    companion object {
        private const val TAG = "RecordingService"
        const val ACTION_START = "com.tghcgu.powerrecorder.START"
        const val ACTION_STOP = "com.tghcgu.powerrecorder.STOP"
    }

    private var mediaRecorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart()
            ACTION_STOP -> handleStop()
            else -> {
                Log.w(TAG, "Unknown action: ${intent?.action}")
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun handleStart() {
        if (mediaRecorder != null) {
            Log.w(TAG, "Already recording — ignoring duplicate start")
            return
        }

        // Must call startForeground within 5s on Android 14+
        val notification = NotificationHelper.buildRecordingNotification(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NotificationHelper.NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NotificationHelper.NOTIFICATION_ID, notification)
        }

        acquireWakeLock()
        startRecording()
    }

    private fun handleStop() {
        stopRecording()
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startRecording() {
        val file = createOutputFile()
        outputFile = file

        mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(this)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        mediaRecorder?.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(44100)
            setAudioEncodingBitRate(128_000)
            setAudioChannels(1) // Mono — sufficient for voice, smaller files
            setOutputFile(file.absolutePath)

            try {
                prepare()
                start()
                Log.d(TAG, "Recording started: ${file.absolutePath}")
            } catch (e: IOException) {
                Log.e(TAG, "prepare() failed: ${e.message}")
                cleanup()
            } catch (e: IllegalStateException) {
                Log.e(TAG, "start() failed — wrong state: ${e.message}")
                cleanup()
            }
        }
    }

    private fun stopRecording() {
        mediaRecorder?.apply {
            try {
                stop()
                release()
                Log.d(TAG, "Recording stopped. Saved: ${outputFile?.absolutePath} (${outputFile?.length()} bytes)")
            } catch (e: RuntimeException) {
                // Thrown if recording was too short or already stopped
                Log.e(TAG, "stop() failed: ${e.message}")
                outputFile?.delete()
            }
        }
        mediaRecorder = null
        outputFile = null
        PowerButtonAccessibilityService.isRecording = false
    }

    private fun cleanup() {
        mediaRecorder?.release()
        mediaRecorder = null
        outputFile?.delete()
        outputFile = null
        PowerButtonAccessibilityService.isRecording = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createOutputFile(): File {
        // Save to app-specific external directory — no storage permission required
        val dir = getExternalFilesDir("Recordings")
            ?: filesDir.also { File(it, "Recordings").mkdirs() }

        File(dir, "Recordings").mkdirs()
        val recordingsDir = File(dir, "Recordings").takeIf { it.exists() } ?: dir

        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        return File(recordingsDir, "REC_$timestamp.m4a")
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "PowerButtonRecorder::RecordingLock"
        ).apply {
            acquire(60 * 60 * 1000L) // Up to 1 hour; released explicitly in releaseWakeLock()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRecording()
        releaseWakeLock()
    }
}
