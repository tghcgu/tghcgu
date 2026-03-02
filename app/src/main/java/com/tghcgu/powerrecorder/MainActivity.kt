package com.tghcgu.powerrecorder

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.tghcgu.powerrecorder.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        updateUI()
        if (results[Manifest.permission.RECORD_AUDIO] == false) {
            showPermissionDeniedDialog()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        NotificationHelper.createChannel(this)

        binding.btnGrantPermissions.setOnClickListener { requestRequiredPermissions() }
        binding.btnOpenAccessibility.setOnClickListener { showAccessibilityGuide() }
    }

    override fun onResume() {
        super.onResume()
        updateUI()
    }

    private fun updateUI() {
        val audioOk = hasPermission(Manifest.permission.RECORD_AUDIO)
        val notifOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        } else true
        val accessOk = isAccessibilityEnabled()
        val allOk = audioOk && notifOk && accessOk

        binding.tvStatusAudio.text = "マイク権限: ${if (audioOk) "✓ 許可済み" else "✗ 必要"}"
        binding.tvStatusNotification.text = "通知権限: ${if (notifOk) "✓ 許可済み" else "✗ 必要"}"
        binding.tvStatusAccessibility.text = "アクセシビリティ: ${if (accessOk) "✓ 有効" else "✗ 手動で有効化が必要"}"

        binding.tvOverallStatus.text = if (allOk) {
            "準備完了！\n電源ボタンを長押し (0.6秒以上) して録音を開始"
        } else {
            "以下のセットアップを完了してください"
        }
        binding.tvOverallStatus.setTextColor(
            if (allOk) getColor(R.color.colorSuccess) else getColor(R.color.colorWarning)
        )

        binding.btnGrantPermissions.isEnabled = !audioOk || !notifOk
        binding.btnOpenAccessibility.isEnabled = !accessOk
    }

    private fun requestRequiredPermissions() {
        val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        requestPermissions.launch(perms.toTypedArray())
    }

    private fun showAccessibilityGuide() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.dialog_accessibility_title))
            .setMessage(getString(R.string.dialog_accessibility_message))
            .setPositiveButton(getString(R.string.dialog_open_settings)) { _, _ ->
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showPermissionDeniedDialog() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.dialog_permission_title))
            .setMessage(getString(R.string.dialog_permission_message))
            .setPositiveButton(getString(R.string.dialog_open_settings)) { _, _ ->
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                })
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun isAccessibilityEnabled(): Boolean {
        val am = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabled = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        val ourService = "${packageName}/.PowerButtonAccessibilityService"

        // Primary: check via AccessibilityManager
        if (enabled.any { info ->
            val si = info.resolveInfo.serviceInfo
            "${si.packageName}/${si.name}" == ourService ||
            si.name == PowerButtonAccessibilityService::class.java.name
        }) return true

        // Fallback: check Settings.Secure string directly
        val setting = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false

        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(setting)
        return splitter.any { it.equals(ourService, ignoreCase = true) }
    }
}
