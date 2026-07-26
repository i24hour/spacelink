package com.deadlineai.monitor

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Front-of-screen continue UI. Can appear over the lock screen via full-screen intent so the
 * user does not need to open the notification shade.
 */
class ResumeCaptureActivity : Activity() {
    private lateinit var prefs: AppPrefs
    private lateinit var statusText: TextView
    private lateinit var continueButton: Button
    private lateinit var notNowButton: Button
    private var promptInFlight = false
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = AppPrefs(this)
        prepareLockScreenPresentation()
        setContentView(buildView())

        if (!prefs.awaitingResumeAfterLock || prefs.mobileToken == null || prefs.goal.trim().length < 3) {
            statusText.text = "Nothing to resume. Open SpaceLink Focus if you want to start monitoring."
            continueButton.isEnabled = false
            return
        }

        if (isKeyguardLocked()) {
            statusText.text = "Unlock your phone, then tap Continue (or Continue after unlock)."
            // Keep UI visible over lock screen; auto-start capture only after unlock.
            return
        }

        mainHandler.postDelayed({ requestScreenCapture() }, 250L)
    }

    override fun onResume() {
        super.onResume()
        if (!::prefs.isInitialized || !::statusText.isInitialized) return
        if (!prefs.awaitingResumeAfterLock || promptInFlight) return
        if (!isKeyguardLocked() && prefs.mobileToken != null && prefs.goal.trim().length >= 3) {
            statusText.text = "Phone unlocked. Allow screen capture to continue monitoring..."
            mainHandler.postDelayed({ requestScreenCapture() }, 200L)
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun prepareLockScreenPresentation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            keyguard.requestDismissKeyguard(this, null)
        }
    }

    private fun buildView(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 44, 48, 40)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 28f
            }
            elevation = 12f
        }

        card.addView(TextView(this).apply {
            text = "Continue SpaceLink Focus?"
            textSize = 22f
            setTextColor(0xFF172033.toInt())
            setPadding(0, 0, 0, 12)
        })
        statusText = TextView(this).apply {
            text = "Tap Continue, then Allow on the Android screen-share prompt."
            textSize = 15f
            setTextColor(0xFF334155.toInt())
        }
        card.addView(statusText)

        continueButton = Button(this).apply {
            text = "Continue"
            setOnClickListener { requestScreenCapture() }
        }
        notNowButton = Button(this).apply {
            text = "Not now"
            setOnClickListener { finish() }
        }
        card.addView(continueButton, buttonParams())
        card.addView(notNowButton, buttonParams())

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0x990F172A.toInt())
            gravity = Gravity.CENTER
            setPadding(36, 36, 36, 36)
            addView(
                card,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }
    }

    private fun buttonParams() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
        topMargin = 14
    }

    private fun requestScreenCapture() {
        if (promptInFlight) return
        if (isKeyguardLocked()) {
            statusText.text = "Unlock your phone first, then tap Continue."
            val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                keyguard.requestDismissKeyguard(this, null)
            }
            return
        }
        if (prefs.mobileToken == null || prefs.goal.trim().length < 3) {
            Toast.makeText(this, "Open SpaceLink Focus and set up monitoring first", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        try {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
                ?: throw IllegalStateException("Android screen-capture service is unavailable")
            promptInFlight = true
            continueButton.isEnabled = false
            statusText.text = "Allow screen capture on the next Android screen..."
            val captureIntent = if (Build.VERSION.SDK_INT >= 34) {
                manager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay()
                )
            } else {
                manager.createScreenCaptureIntent()
            }
            startActivityForResult(captureIntent, REQUEST_CAPTURE)
        } catch (error: Exception) {
            promptInFlight = false
            continueButton.isEnabled = true
            statusText.text = error.message ?: "Could not open screen-capture permission"
        }
    }

    @Deprecated("Android activity result API retained for broad device compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        promptInFlight = false
        continueButton.isEnabled = true
        if (resultCode != RESULT_OK || data == null) {
            UnlockResumeCoordinator.markAwaitingResume(this)
            statusText.text = "Permission denied. Tap Continue when ready, or Not now."
            Toast.makeText(this, "Screen capture permission was not granted", Toast.LENGTH_LONG).show()
            return
        }

        val mobileToken = prefs.mobileToken
        val goal = prefs.goal.trim()
        if (mobileToken == null || goal.length < 3) {
            statusText.text = "Missing pairing or goal. Open SpaceLink Focus to fix this."
            return
        }

        ProjectionPermissionStore.put(resultCode, data)
        val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_TOKEN, mobileToken)
            putExtra(ScreenCaptureService.EXTRA_GOAL, goal)
            putExtra(ScreenCaptureService.EXTRA_INTERVAL_MINUTES, prefs.intervalMinutes)
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_REATTACH_SESSION, true)
        }
        try {
            prefs.userRequestedStop = false
            prefs.monitoringError = null
            prefs.lastCrash = null
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            prefs.monitoringActive = true
            UnlockOverlayController.dismiss(this)
            UnlockResumeCoordinator.clearAwaitingResume(this)
            Toast.makeText(this, "Monitoring continued", Toast.LENGTH_SHORT).show()
            finish()
        } catch (error: Exception) {
            ProjectionPermissionStore.clear()
            prefs.monitoringActive = false
            statusText.text = error.message ?: "Could not restart screen capture"
        }
    }

    private fun isKeyguardLocked(): Boolean {
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        return keyguard.isKeyguardLocked
    }

    companion object {
        private const val REQUEST_CAPTURE = 7101
    }
}
