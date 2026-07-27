package com.deadlineai.monitor

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Shows a true "appear on top" popup after unlock using SYSTEM_ALERT_WINDOW.
 * Full-screen notifications alone are often blocked on OEM builds unless the app
 * is opened manually.
 */
object UnlockOverlayController {
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var overlayView: View? = null

    fun canDrawOverlays(context: Context): Boolean = Settings.canDrawOverlays(context)

    fun requestOverlayPermission(context: Context) {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun dismiss(context: Context) {
        mainHandler.post {
            val view = overlayView ?: return@post
            runCatching {
                val wm = context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                wm.removeView(view)
            }
            overlayView = null
        }
    }

    fun showContinueOverlay(context: Context) {
        val appContext = context.applicationContext
        if (!canDrawOverlays(appContext)) return
        mainHandler.post {
            if (overlayView != null) return@post
            val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val card = buildCard(appContext) {
                dismiss(appContext)
                appContext.startActivity(UnlockResumeCoordinator.resumePopupIntent(appContext))
            }
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_PHONE
                },
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP
                y = 120
            }
            runCatching {
                wm.addView(card, params)
                overlayView = card
            }
        }
    }

    private fun buildCard(context: Context, onContinue: () -> Unit): View {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 36, 40, 28)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = 28f
            }
            elevation = 16f
        }
        card.addView(TextView(context).apply {
            text = "Continue SpaceLink Focus?"
            textSize = 20f
            setTextColor(0xFF172033.toInt())
            setPadding(0, 0, 0, 10)
        })
        card.addView(TextView(context).apply {
            text = "Phone unlocked. Tap Continue, then Allow screen sharing to keep monitoring."
            textSize = 14f
            setTextColor(0xFF334155.toInt())
            setPadding(0, 0, 0, 16)
        })
        card.addView(Button(context).apply {
            text = "Continue"
            setOnClickListener { onContinue() }
        })
        card.addView(Button(context).apply {
            text = "Not now"
            setOnClickListener {
                dismiss(context)
                UnlockResumeCoordinator.declineAndStopMonitoring(context)
            }
        })
        val wrap = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 0, 28, 0)
            addView(
                card,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
            )
        }
        return wrap
    }
}
