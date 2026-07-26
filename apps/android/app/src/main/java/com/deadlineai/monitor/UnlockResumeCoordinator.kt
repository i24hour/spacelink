package com.deadlineai.monitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.app.KeyguardManager
import android.os.Build

/**
 * After Android stops MediaProjection on lock, keep the monitoring intent alive and
 * prompt the user to re-grant screen capture once the phone is unlocked.
 */
object UnlockResumeCoordinator {
    private const val CHANNEL_ID = "spacelink_resume_after_lock"
    const val NOTIFICATION_ID = 4183
    const val EXTRA_AUTO_RESUME_CAPTURE = "auto_resume_capture"

    @Volatile
    private var receiverRegistered = false

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent?) {
            val action = intent?.action ?: return
            if (action != Intent.ACTION_USER_PRESENT && action != Intent.ACTION_SCREEN_ON) return
            val appContext = context.applicationContext
            val prefs = AppPrefs(appContext)
            if (!prefs.awaitingResumeAfterLock) {
                unregister(appContext)
                return
            }
            if (isKeyguardLocked(appContext)) return
            showResumeNotification(appContext)
            launchResumeActivity(appContext)
        }
    }

    fun markAwaitingResume(context: Context) {
        val appContext = context.applicationContext
        val prefs = AppPrefs(appContext)
        prefs.awaitingResumeAfterLock = true
        prefs.monitoringActive = false
        prefs.monitoringError =
            "Screen locked. Unlock your phone and allow screen capture again to continue."
        register(appContext)
        showResumeNotification(appContext)
    }

    fun clearAwaitingResume(context: Context) {
        val appContext = context.applicationContext
        val prefs = AppPrefs(appContext)
        prefs.awaitingResumeAfterLock = false
        cancelResumeNotification(appContext)
        unregister(appContext)
    }

    fun ensureRegisteredIfNeeded(context: Context) {
        if (AppPrefs(context.applicationContext).awaitingResumeAfterLock) {
            register(context.applicationContext)
            showResumeNotification(context.applicationContext)
        }
    }

    fun resumeActivityIntent(context: Context): Intent {
        return Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_AUTO_RESUME_CAPTURE, true)
        }
    }

    private fun register(context: Context) {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_SCREEN_ON)
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
            context.startActivity(resumeActivityIntent(context))
        }
    }

    private fun showResumeNotification(context: Context) {
        createChannel(context)
        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            resumeActivityIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("SpaceLink ready to continue")
            .setContentText("Phone unlocked. Tap to allow screen capture and resume focus checks.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOngoing(false)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun cancelResumeNotification(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(NOTIFICATION_ID)
    }

    private fun createChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "SpaceLink resume after lock",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Prompts you to continue monitoring after the screen was locked"
            }
        )
    }

    private fun isKeyguardLocked(context: Context): Boolean {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return keyguard.isKeyguardLocked
    }
}
