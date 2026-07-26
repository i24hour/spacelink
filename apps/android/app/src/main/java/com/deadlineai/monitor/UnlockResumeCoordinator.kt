package com.deadlineai.monitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.SystemClock
import android.provider.Settings

/**
 * After Android stops MediaProjection on lock, keep a watch service alive and prompt on unlock:
 * overlay (if allowed), full-screen intent, and activity launch.
 */
object UnlockResumeCoordinator {
    private const val CHANNEL_ID = "spacelink_resume_after_lock"
    const val NOTIFICATION_ID = 4183
    const val EXTRA_AUTO_RESUME_CAPTURE = "auto_resume_capture"
    private const val FULL_SCREEN_COOLDOWN_MS = 8_000L

    @Volatile
    private var receiverRegistered = false

    @Volatile
    private var lastFullScreenAtElapsed = 0L

    @Volatile
    private var lastPromptAtElapsed = 0L

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent?) {
            val action = intent?.action ?: return
            if (action != Intent.ACTION_USER_PRESENT && action != Intent.ACTION_SCREEN_ON) return
            val appContext = context.applicationContext
            val prefs = AppPrefs(appContext)
            if (!prefs.awaitingResumeAfterLock) {
                unregister(appContext)
                UnlockWatchService.stop(appContext)
                return
            }
            if (action == Intent.ACTION_SCREEN_ON && isKeyguardLocked(appContext)) {
                showLockedWaitingNotification(appContext)
                return
            }
            if (isKeyguardLocked(appContext)) return
            promptOnUnlock(appContext)
        }
    }

    fun markAwaitingResume(context: Context) {
        val appContext = context.applicationContext
        val prefs = AppPrefs(appContext)
        prefs.awaitingResumeAfterLock = true
        prefs.monitoringActive = false
        prefs.monitoringError = if (UnlockOverlayController.canDrawOverlays(appContext)) {
            "Screen locked. After unlock, SpaceLink will pop up to continue."
        } else {
            "Screen locked. After unlock, tap the SpaceLink notification (or enable Display over other apps for auto popup)."
        }
        register(appContext)
        showLockedWaitingNotification(appContext)
        // Critical: keep process alive so unlock broadcasts are received.
        UnlockWatchService.start(appContext)
        if (!isKeyguardLocked(appContext)) {
            promptOnUnlock(appContext)
        }
    }

    fun clearAwaitingResume(context: Context) {
        val appContext = context.applicationContext
        val prefs = AppPrefs(appContext)
        prefs.awaitingResumeAfterLock = false
        UnlockOverlayController.dismiss(appContext)
        cancelResumeNotification(appContext)
        unregister(appContext)
        UnlockWatchService.stop(appContext)
    }

    fun ensureRegisteredIfNeeded(context: Context) {
        if (AppPrefs(context.applicationContext).awaitingResumeAfterLock) {
            register(context.applicationContext)
            showLockedWaitingNotification(context.applicationContext)
            UnlockWatchService.start(context.applicationContext)
        }
    }

    fun onWatchServiceStarted(context: Context) {
        register(context.applicationContext)
    }

    fun onWatchServiceStopping(context: Context) {
        // Keep receiver if we are still awaiting and process remains alive.
        if (!AppPrefs(context.applicationContext).awaitingResumeAfterLock) {
            unregister(context.applicationContext)
        }
    }

    fun resumePopupIntent(context: Context): Intent {
        return Intent(context, ResumeCaptureActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_NO_USER_ACTION
            putExtra(EXTRA_AUTO_RESUME_CAPTURE, true)
        }
    }

    fun resumeActivityIntent(context: Context): Intent = resumePopupIntent(context)

    private fun promptOnUnlock(context: Context) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastPromptAtElapsed < 2_500L) return
        lastPromptAtElapsed = now

        val allowFullScreen = now - lastFullScreenAtElapsed >= FULL_SCREEN_COOLDOWN_MS
        if (allowFullScreen) {
            lastFullScreenAtElapsed = now
        }

        if (UnlockOverlayController.canDrawOverlays(context)) {
            UnlockOverlayController.showContinueOverlay(context)
        }

        showResumeNotification(context, useFullScreen = allowFullScreen)
        launchResumeActivity(context)
    }

    private fun register(context: Context) {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_SCREEN_ON)
            priority = IntentFilter.SYSTEM_HIGH_PRIORITY
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(unlockReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(unlockReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun unregister(context: Context) {
        if (!receiverRegistered) return
        runCatching { context.unregisterReceiver(unlockReceiver) }
        receiverRegistered = false
    }

    private fun launchResumeActivity(context: Context) {
        runCatching {
            context.startActivity(resumePopupIntent(context))
        }
    }

    private fun showLockedWaitingNotification(context: Context) {
        createChannel(context)
        val pendingIntent = popupPendingIntent(context)
        val text = if (UnlockOverlayController.canDrawOverlays(context)) {
            "Phone locked. Unlock — continue popup will appear."
        } else {
            "Phone locked. After unlock, tap here to continue SpaceLink."
        }
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("SpaceLink paused while locked")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun showResumeNotification(context: Context, useFullScreen: Boolean) {
        createChannel(context)
        val pendingIntent = popupPendingIntent(context)
        val builder = Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("Continue SpaceLink Focus")
            .setContentText("Tap to allow screen capture and resume monitoring.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOngoing(false)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)

        if (useFullScreen && canUseFullScreenIntent(context)) {
            builder.setFullScreenIntent(pendingIntent, true)
            @Suppress("DEPRECATION")
            builder.setPriority(Notification.PRIORITY_MAX)
        } else {
            @Suppress("DEPRECATION")
            builder.setPriority(Notification.PRIORITY_HIGH)
        }

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, builder.build())
    }

    private fun popupPendingIntent(context: Context): PendingIntent {
        return PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            resumePopupIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun cancelResumeNotification(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(NOTIFICATION_ID)
        manager.cancel(UnlockWatchService.NOTIFICATION_ID)
    }

    private fun createChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "SpaceLink resume after lock",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Shows a continue prompt after you unlock"
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            enableVibration(true)
            setBypassDnd(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun canUseFullScreenIntent(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 34) return true
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return runCatching { manager.canUseFullScreenIntent() }.getOrDefault(false)
    }

    fun openFullScreenIntentSettings(context: Context) {
        if (Build.VERSION.SDK_INT < 34) return
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                    data = android.net.Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }
    }

    private fun isKeyguardLocked(context: Context): Boolean {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return keyguard.isKeyguardLocked
    }
}
