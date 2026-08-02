package com.deadlineai.monitor

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Stays alive after lock and actively watches for unlock.
 * USER_PRESENT alone is unreliable on some OEMs (incl. Motorola); we also poll keyguard state.
 */
class UnlockWatchService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var keyguardListenerRegistered = false
    private var wasLocked = true
    private var promptedForCurrentUnlock = false

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!AppPrefs(this@UnlockWatchService).awaitingResumeAfterLock) {
                stopSelf()
                return
            }
            checkUnlockTransition(reason = "poll")
            mainHandler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    private val keyguardListener = KeyguardManager.KeyguardLockedStateListener {
        mainHandler.post { checkUnlockTransition(reason = "keyguard_listener") }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        wasLocked = isKeyguardLocked()
        promptedForCurrentUnlock = false
        promoteForeground(waiting = true)
        UnlockResumeCoordinator.onWatchServiceStarted(this)
        registerKeyguardListener()
        mainHandler.post(pollRunnable)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            cleanupAndStop()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_CONTINUE) {
            if (!isKeyguardLocked()) {
                UnlockResumeCoordinator.promptBringToFront(this, reason = "notification_action")
            }
            return START_STICKY
        }
        val prefs = AppPrefs(this)
        if (!prefs.awaitingResumeAfterLock) {
            cleanupAndStop()
            return START_NOT_STICKY
        }
        UnlockResumeCoordinator.onWatchServiceStarted(this)
        checkUnlockTransition(reason = "start_command")
        return START_STICKY
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        unregisterKeyguardListener()
        UnlockResumeCoordinator.onWatchServiceStopping(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun checkUnlockTransition(reason: String) {
        if (!AppPrefs(this).awaitingResumeAfterLock) return
        val locked = isKeyguardLocked()
        val interactive = isInteractive()

        if (locked) {
            wasLocked = true
            promptedForCurrentUnlock = false
            return
        }

        // Unlocked path: require screen interactive so we don't fire in odd doze states.
        if (!interactive) return

        val justUnlocked = wasLocked || reason == "keyguard_listener" || reason == "notification_action"
        wasLocked = false
        if (!justUnlocked && promptedForCurrentUnlock) return
        if (promptedForCurrentUnlock && reason == "poll") return

        promptedForCurrentUnlock = true
        promoteForeground(waiting = false)
        android.util.Log.i("SpaceLinkUnlock", "unlock detected via $reason — prompting")
        UnlockResumeCoordinator.promptBringToFront(this, reason = "watch_$reason")
    }

    private fun promoteForeground(waiting: Boolean) {
        val notification = buildNotification(waiting)
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
        } catch (_: Throwable) {
            runCatching {
                @Suppress("DEPRECATION")
                startForeground(NOTIFICATION_ID, notification)
            }
        }
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun buildNotification(waiting: Boolean): Notification {
        val continueIntent = UnlockResumeCoordinator.resumePopupIntent(this)
        val contentPending = PendingIntent.getActivity(
            this,
            NOTIFICATION_ID,
            continueIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val actionPending = PendingIntent.getService(
            this,
            NOTIFICATION_ID + 3,
            Intent(this, UnlockWatchService::class.java).setAction(ACTION_CONTINUE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val title = if (waiting) "SpaceLink waiting for unlock" else "Continue SpaceLink Focus"
        val text = if (waiting) {
            "Unlock the phone — Continue will open after unlock."
        } else {
            "Phone unlocked. Tap Continue to allow screen sharing."
        }
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(contentPending)
            .setOngoing(true)
            .setOnlyAlertOnce(waiting)
            .setCategory(if (waiting) Notification.CATEGORY_SERVICE else Notification.CATEGORY_ALARM)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_media_play,
                    "Continue",
                    actionPending
                ).build()
            )

        if (!waiting) {
            builder.setFullScreenIntent(contentPending, true)
            @Suppress("DEPRECATION")
            builder.setPriority(Notification.PRIORITY_MAX)
        }
        return builder.build()
    }

    private fun createChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "SpaceLink waiting after lock",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Detects unlock and opens Continue for screen capture"
                enableVibration(true)
                setBypassDnd(true)
                setShowBadge(true)
            }
        )
    }

    private fun registerKeyguardListener() {
        if (Build.VERSION.SDK_INT < 33 || keyguardListenerRegistered) return
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        runCatching {
            keyguard.addKeyguardLockedStateListener(mainExecutor, keyguardListener)
            keyguardListenerRegistered = true
        }
    }

    private fun unregisterKeyguardListener() {
        if (Build.VERSION.SDK_INT < 33 || !keyguardListenerRegistered) return
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        runCatching { keyguard.removeKeyguardLockedStateListener(keyguardListener) }
        keyguardListenerRegistered = false
    }

    private fun cleanupAndStop() {
        mainHandler.removeCallbacksAndMessages(null)
        unregisterKeyguardListener()
        UnlockResumeCoordinator.onWatchServiceStopping(this)
        stopSelf()
    }

    private fun isKeyguardLocked(): Boolean {
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        return keyguard.isKeyguardLocked
    }

    private fun isInteractive(): Boolean {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        return power.isInteractive
    }

    companion object {
        const val ACTION_STOP = "com.deadlineai.monitor.STOP_UNLOCK_WATCH"
        const val ACTION_CONTINUE = "com.deadlineai.monitor.CONTINUE_AFTER_UNLOCK"
        private const val CHANNEL_ID = "spacelink_unlock_watch"
        const val NOTIFICATION_ID = 4184
        private const val POLL_INTERVAL_MS = 800L

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
