package com.example.powerrecorder

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.widget.Button
import android.widget.ImageView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.card.MaterialCardView

/**
 * セットアップ画面。
 *
 * ユーザーに以下の 2 ステップを案内する:
 *   Step 1: マイク権限の許可
 *   Step 2: アクセシビリティサービスの有効化
 *
 * 両方完了すると「準備完了」状態を表示し、電源ボタン長押しで録音できることを伝える。
 */
class MainActivity : AppCompatActivity() {

    // -------------------------------------------------------------------------
    // 権限リクエストランチャー
    // -------------------------------------------------------------------------

    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { updateUi() }

    // -------------------------------------------------------------------------
    // ライフサイクル
    // -------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.btnGrantPermission).setOnClickListener {
            requestAudioPermissions()
        }

        findViewById<Button>(R.id.btnOpenAccessibility).setOnClickListener {
            openAccessibilitySettings()
        }
    }

    override fun onResume() {
        super.onResume()
        updateUi()
    }

    // -------------------------------------------------------------------------
    // UI 更新
    // -------------------------------------------------------------------------

    private fun updateUi() {
        val permissionGranted = hasAudioPermission()
        val accessibilityEnabled = isAccessibilityServiceEnabled()

        // Step 1: マイク権限
        val step1Status = findViewById<ImageView>(R.id.imgStep1Status)
        val btnGrant = findViewById<Button>(R.id.btnGrantPermission)
        step1Status.setImageResource(
            if (permissionGranted) android.R.drawable.checkbox_on_background
            else android.R.drawable.checkbox_off_background
        )
        btnGrant.visibility = if (permissionGranted) View.GONE else View.VISIBLE

        // Step 2: アクセシビリティサービス
        val step2Status = findViewById<ImageView>(R.id.imgStep2Status)
        val btnAccessibility = findViewById<Button>(R.id.btnOpenAccessibility)
        step2Status.setImageResource(
            if (accessibilityEnabled) android.R.drawable.checkbox_on_background
            else android.R.drawable.checkbox_off_background
        )
        btnAccessibility.visibility = if (accessibilityEnabled) View.GONE else View.VISIBLE

        // 完了バナー
        val tvReady = findViewById<MaterialCardView>(R.id.tvReady)
        tvReady.visibility = if (permissionGranted && accessibilityEnabled) View.VISIBLE else View.GONE
    }

    // -------------------------------------------------------------------------
    // 権限チェック・リクエスト
    // -------------------------------------------------------------------------

    private fun hasAudioPermission(): Boolean {
        val audioGranted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else true

        return audioGranted && notifGranted
    }

    private fun requestAudioPermissions() {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        requestPermissions.launch(permissions.toTypedArray())
    }

    // -------------------------------------------------------------------------
    // アクセシビリティサービス確認
    // -------------------------------------------------------------------------

    private fun isAccessibilityServiceEnabled(): Boolean {
        val serviceName = "${packageName}/${PowerButtonService::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val colonSplitter = TextUtils.SimpleStringSplitter(':')
        colonSplitter.setString(enabledServices)
        while (colonSplitter.hasNext()) {
            if (colonSplitter.next().equals(serviceName, ignoreCase = true)) return true
        }
        return false
    }

    private fun openAccessibilitySettings() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }
}
