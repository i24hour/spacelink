package com.deadlineai.monitor

import android.app.ActivityOptions
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings

/**
 * After MediaProjection stops on lock, keep a watch service alive and bring the continue
 * UI to the front only after the user fully unlocks (USER_PRESENT).
 * Never open the Android share-screen dialog on the lock screen.
 */
object UnlockResumeCoordinator {
    private const val CHANNEL_ID = "spacelink_resume_after_lock"
    const val NOTIFICATION_ID = 4183
    const val EXTRA_AUTO_RESUME_CAPTURE = "auto_resume_capture"
    private const val PROMPT_COOLDOWN_MS = 2_000L

    @Volatile
    private var receiverRegistered = false

    @Volatile
    private var lastPromptAtElapsed = 0L

    private val mainHandler = Handler(Looper.getMainLooper())

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent?) {
            val action = intent?.action ?: return
            if (
                action != Intent.ACTION_USER_PRESENT &&
                action != Intent.ACTION_SCREEN_ON &&
                action != Intent.ACTION_USER_UNLOCKED
            ) return
            val appContext = context.applicationContext
            val prefs = AppPrefs(appContext)
            if (!prefs.awaitingResumeAfterLock) {
                unregister(appContext)
                UnlockWatchService.stop(appContext)
                return
            }

            when (action) {
                Intent.ACTION_SCREEN_ON -> {
                    // Keep waiting notification only while still locked.
                    if (isKeyguardLocked(appContext)) {
                        showWaitingNotification(appContext)
                    } else {
                        // Some OEMs skip USER_PRESENT; screen-on can already be unlocked.
                        promptBringToFront(appContext, reason = "screen_on_unlocked")
                    }
                }
                Intent.ACTION_USER_PRESENT, Intent.ACTION_USER_UNLOCKED -> {
                    promptBringToFront(appContext, reason = action)
                }
            }
        }
    }

    fun markAwaitingResume(context: Context) {
        val appContext = context.applicationContext
        val prefs = AppPrefs(appContext)
        prefs.awaitingResumeAfterLock = true
        prefs.monitoringActive = false
        prefs.monitoringError =
            "Screen locked. After you unlock the phone, SpaceLink will ask to continue (not on the lock screen)."
        register(appContext)
        showWaitingNotification(appContext)
        UnlockWatchService.start(appContext)
        // Only prompt if already unlocked (e.g. projection stopped for another reason).
        if (!isKeyguardLocked(appContext)) {
            promptBringToFront(appContext, reason = "already_unlocked")
        }
    }

    fun clearAwaitingResume(context: Context) {
        val appContext = context.applicationContext
        AppPrefs(appContext).awaitingResumeAfterLock = false
        UnlockOverlayController.dismiss(appContext)
        cancelResumeNotification(appContext)
        unregister(appContext)
        UnlockWatchService.stop(appContext)
    }

    fun ensureRegisteredIfNeeded(context: Context) {
        if (AppPrefs(context.applicationContext).awaitingResumeAfterLock) {
            register(context.applicationContext)
            showWaitingNotification(context.applicationContext)
            UnlockWatchService.start(context.applicationContext)
        }
    }

    fun onWatchServiceStarted(context: Context) {
        register(context.applicationContext)
    }

    fun onWatchServiceStopping(context: Context) {
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

    fun promptBringToFront(context: Context, reason: String) {
        val appContext = context.applicationContext
        // Hard guard: never open Continue / share-screen over the lock screen.
        if (isKeyguardLocked(appContext)) {
            showWaitingNotification(appContext)
            android.util.Log.i("SpaceLinkUnlock", "skip prompt while locked reason=$reason")
            return
        }

        val now = SystemClock.elapsedRealtime()
        if (now - lastPromptAtElapsed < PROMPT_COOLDOWN_MS) return
        lastPromptAtElapsed = now
        android.util.Log.i("SpaceLinkUnlock", "promptBringToFront reason=$reason")

        if (UnlockOverlayController.canDrawOverlays(appContext)) {
            UnlockOverlayController.showContinueOverlay(appContext)
        }

        postFullScreenContinueNotification(appContext)
        mainHandler.post {
            if (isKeyguardLocked(appContext)) return@post
            launchResumeActivity(appContext)
            sendFullScreenPendingIntent(appContext)
        }
    }

    private fun register(context: Context) {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_USER_UNLOCKED)
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
        val intent = resumePopupIntent(context)
        // Prefer PendingIntent.send from app context — more likely to clear background
        // activity-start restrictions than bare startActivity from a service.
        runCatching {
            val pending = PendingIntent.getActivity(
                context,
                NOTIFICATION_ID + 21,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            if (Build.VERSION.SDK_INT >= 34) {
                val options = ActivityOptions.makeBasic().apply {
                    setPendingIntentBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    )
                }
                pending.send(context, 0, null, null, null, null, options.toBundle())
            } else {
                pending.send()
            }
        }.onFailure {
            android.util.Log.w("SpaceLinkUnlock", "pending send failed: ${it.message}")
            runCatching { context.startActivity(intent) }
        }
    }

    private fun sendFullScreenPendingIntent(context: Context) {
        runCatching {
            val pending = fullScreenPendingIntent(context)
            if (Build.VERSION.SDK_INT >= 34) {
                val options = ActivityOptions.makeBasic().apply {
                    setPendingIntentBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    )
                }
                pending.send(context, 0, null, null, null, null, options.toBundle())
            } else {
                pending.send()
            }
        }
    }

    private fun showWaitingNotification(context: Context) {
        createChannel(context)
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("SpaceLink paused while locked")
            .setContentText("Unlock the phone first — then Continue will open.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(contentPendingIntent(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun postFullScreenContinueNotification(context: Context) {
        createChannel(context)
        ensureFullScreenIntentAllowed(context)

        val fullScreen = fullScreenPendingIntent(context)
        val builder = Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("Continue SpaceLink Focus")
            .setContentText("Allow screen capture to resume monitoring.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(contentPendingIntent(context))
            .setFullScreenIntent(fullScreen, true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(false)

        @Suppress("DEPRECATION")
        builder.setPriority(Notification.PRIORITY_MAX)

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Use a distinct id so the full-screen alert is re-posted every wake.
        manager.notify(NOTIFICATION_ID + 1, builder.build())
    }

    private fun contentPendingIntent(context: Context): PendingIntent {
        return PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            resumePopupIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun fullScreenPendingIntent(context: Context): PendingIntent {
        return PendingIntent.getActivity(
            context,
            NOTIFICATION_ID + 11,
            resumePopupIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun cancelResumeNotification(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(NOTIFICATION_ID)
        manager.cancel(NOTIFICATION_ID + 1)
        manager.cancel(UnlockWatchService.NOTIFICATION_ID)
    }

    private fun createChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "SpaceLink resume after lock",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Opens Continue on screen after lock/unlock"
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            enableVibration(true)
            setBypassDnd(true)
        }
        manager.createNotificationChannel(channel)
    }

    private fun ensureFullScreenIntentAllowed(context: Context) {
        if (Build.VERSION.SDK_INT < 34) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val allowed = runCatching { manager.canUseFullScreenIntent() }.getOrDefault(false)
        if (!allowed) {
            // Best effort: send user to the setting once from the help button paths.
            android.util.Log.w("SpaceLinkUnlock", "Full-screen intent not allowed for package")
        }
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
