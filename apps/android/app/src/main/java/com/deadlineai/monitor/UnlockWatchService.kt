package com.deadlineai.monitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the process alive after MediaProjection stops on lock, so unlock events can still
 * trigger the continue popup/notification. Without this, Android often kills the app and
 * the dynamic unlock listener disappears.
 */
class UnlockWatchService : Service() {
    override fun onCreate() {
        super.onCreate()
        createChannel()
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                @Suppress("DEPRECATION")
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (error: Throwable) {
            runCatching {
                @Suppress("DEPRECATION")
                startForeground(NOTIFICATION_ID, notification)
            }.onFailure {
                AppPrefs(this).recordCrash(error)
                stopSelf()
            }
        }
        UnlockResumeCoordinator.onWatchServiceStarted(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            UnlockResumeCoordinator.onWatchServiceStopping(this)
            stopSelf()
            return START_NOT_STICKY
        }
        val prefs = AppPrefs(this)
        if (!prefs.awaitingResumeAfterLock) {
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
        UnlockResumeCoordinator.onWatchServiceStarted(this)
        return START_STICKY
    }

    override fun onDestroy() {
        UnlockResumeCoordinator.onWatchServiceStopping(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            NOTIFICATION_ID,
            UnlockResumeCoordinator.resumePopupIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SpaceLink waiting for unlock")
            .setContentText("Wake the phone — Continue should open on screen.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun createChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "SpaceLink waiting after lock",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Keeps SpaceLink ready to ask for screen capture after unlock"
                setShowBadge(true)
            }
        )
    }

    companion object {
        const val ACTION_STOP = "com.deadlineai.monitor.STOP_UNLOCK_WATCH"
        private const val CHANNEL_ID = "spacelink_unlock_watch"
        const val NOTIFICATION_ID = 4184

        fun start(context: Context) {
            val appContext = context.applicationContext
            val intent = Intent(appContext, UnlockWatchService::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                appContext.startForegroundService(intent)
            } else {
                appContext.startService(intent)
            }
        }

        fun stop(context: Context) {
            val appContext = context.applicationContext
            runCatching {
                appContext.startService(
                    Intent(appContext, UnlockWatchService::class.java).setAction(ACTION_STOP)
                )
            }
            runCatching {
                appContext.stopService(Intent(appContext, UnlockWatchService::class.java))
            }
            val manager = appContext.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            manager.cancel(NOTIFICATION_ID)
        }
    }
}
