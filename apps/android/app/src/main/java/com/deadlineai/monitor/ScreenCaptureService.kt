package com.deadlineai.monitor

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import java.nio.ByteBuffer
import java.time.Instant
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

class ScreenCaptureService : Service() {
    private val api = ApiClient()
    private val uploadExecutor = Executors.newSingleThreadExecutor()
    private lateinit var prefs: AppPrefs
    private lateinit var captureThread: HandlerThread
    private lateinit var captureHandler: Handler
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var token: String? = null
    private var width = 0
    private var height = 0
    private var density = 0
    private var captureIntervalMs = DEFAULT_CAPTURE_INTERVAL_MS
    private var capturesEnabled = false
    private var consecutiveCaptureMisses = 0
    private var intervalMinutes = DEFAULT_INTERVAL_MINUTES
    private var monitoringGoal: String? = null
    private var reattachExistingSession = false
    @Volatile
    private var serviceDestroyed = false
    @Volatile
    private var handlingProjectionStop = false

    private val captureRunnable = object : Runnable {
        override fun run() {
            if (!capturesEnabled) return
            try {
                val captured = captureFrame()
                consecutiveCaptureMisses = if (captured) 0 else consecutiveCaptureMisses + 1
                if (capturesEnabled) {
                    val nextDelay = if (captured || consecutiveCaptureMisses >= MAX_CAPTURE_RETRIES) {
                        consecutiveCaptureMisses = 0
                        captureIntervalMs
                    } else {
                        CAPTURE_RETRY_DELAY_MS
                    }
                    captureHandler.postDelayed(this, nextDelay)
                }
            } catch (error: Throwable) {
                failAndStop("Capture worker failed", error)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        prefs = AppPrefs(this)
        prefs.monitoringActive = false
        captureThread = HandlerThread("spacelink-screen-capture").also { it.start() }
        captureHandler = Handler(captureThread.looper)
        createNotificationChannel()
        try {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(paused = false),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } catch (error: Throwable) {
            prefs.recordCrash(error)
            throw error
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = try {
        handleStartCommand(intent)
    } catch (error: Throwable) {
        failAndStop("Screen capture service failed", error)
        START_NOT_STICKY
    }

    private fun handleStartCommand(intent: Intent?): Int {
        when (intent?.action) {
            ACTION_PAUSE -> {
                capturesEnabled = false
                captureHandler.removeCallbacks(captureRunnable)
                updateNotification(paused = true)
                return START_NOT_STICKY
            }
            ACTION_RESUME -> {
                if (mediaProjection != null) {
                    capturesEnabled = true
                    consecutiveCaptureMisses = 0
                    captureHandler.removeCallbacks(captureRunnable)
                    captureHandler.postDelayed(captureRunnable, captureIntervalMs)
                    updateNotification(paused = false)
                }
                return START_NOT_STICKY
            }
            ACTION_CANCEL_AND_STOP -> {
                prefs.userRequestedStop = true
                UnlockResumeCoordinator.clearAwaitingResume(this)
                capturesEnabled = false
                captureHandler.removeCallbacks(captureRunnable)
                releaseCaptureResources()
                stopSelf()
                return START_NOT_STICKY
            }
        }
        if (mediaProjection != null) return START_NOT_STICKY
        // Prefer Intent extras (survives process handoff); fall back to in-memory store.
        // IMPORTANT: Activity.RESULT_OK is -1 on Android, so never treat -1 as "missing".
        val projectionPermission = ProjectionPermissionStore.take()
        val hasResultCodeExtra = intent?.hasExtra(EXTRA_RESULT_CODE) == true
        val resultCode = when {
            hasResultCodeExtra -> intent!!.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            projectionPermission != null -> projectionPermission.resultCode
            else -> null
        }
        val resultData = intent?.let { readResultDataExtra(it) }
            ?: projectionPermission?.resultData
        token = intent?.getStringExtra(EXTRA_TOKEN) ?: prefs.mobileToken
        val goal = intent?.getStringExtra(EXTRA_GOAL)?.trim()?.ifBlank { null } ?: prefs.goal.trim()
        intervalMinutes = intent?.getIntExtra(
            EXTRA_INTERVAL_MINUTES,
            prefs.intervalMinutes
        ) ?: prefs.intervalMinutes
        intervalMinutes = intervalMinutes.coerceIn(5, 60)
        captureIntervalMs = intervalMinutes * 60_000L
        reattachExistingSession = intent?.getBooleanExtra(EXTRA_REATTACH_SESSION, false) == true ||
            prefs.awaitingResumeAfterLock
        val missingFields = buildList {
            if (resultCode == null) add("result code")
            if (resultData == null) add("result data")
            if (token.isNullOrBlank()) add("phone token")
            if (goal.isBlank()) add("goal")
        }
        if (missingFields.isNotEmpty()) {
            prefs.monitoringError = "Monitoring could not start; missing ${missingFields.joinToString()}."
            stopSelf()
            return START_NOT_STICKY
        }
        if (resultCode != Activity.RESULT_OK) {
            prefs.monitoringError = "Monitoring could not start; screen-capture permission was not granted."
            if (prefs.awaitingResumeAfterLock) {
                UnlockResumeCoordinator.markAwaitingResume(this)
            }
            stopSelf()
            return START_NOT_STICKY
        }
        val grantedResultCode = requireNotNull(resultCode)
        val grantedResultData = requireNotNull(resultData)
        monitoringGoal = goal
        prefs.userRequestedStop = false

        updateNotification(paused = false)
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = manager.getMediaProjection(grantedResultCode, grantedResultData)
            ?: throw IllegalStateException("MediaProjection was not granted")
        mediaProjection = projection
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                handleProjectionStopped()
            }
        }, captureHandler)
        setupVirtualDisplay()
        prefs.monitoringActive = true
        prefs.monitoringError = null
        prefs.lastCrash = null
        UnlockResumeCoordinator.clearAwaitingResume(this)
        startApiSessionAndCaptures(token as String, goal, intervalMinutes, reattachExistingSession)
        return START_NOT_STICKY
    }

    private fun handleProjectionStopped() {
        if (handlingProjectionStop || serviceDestroyed) return
        handlingProjectionStop = true
        capturesEnabled = false
        if (::captureHandler.isInitialized) captureHandler.removeCallbacks(captureRunnable)
        releaseCaptureResources()
        mediaProjection = null

        if (prefs.userRequestedStop) {
            prefs.monitoringActive = false
            stopSelf()
            return
        }

        // Android stops projection on lock (and status-bar chip). Keep session intent alive.
        UnlockResumeCoordinator.markAwaitingResume(this)
        stopSelf()
    }

    private fun startApiSessionAndCaptures(
        mobileToken: String,
        goal: String,
        intervalMinutes: Int,
        reattach: Boolean
    ) {
        uploadExecutor.execute {
            val result = try {
                ensureApiSession(mobileToken, goal, intervalMinutes, reattach)
            } catch (error: Throwable) {
                ApiResult(false, "", error.message ?: error.javaClass.simpleName)
            }
            if (serviceDestroyed) return@execute
            if (!result.ok) {
                prefs.monitoringActive = false
                prefs.monitoringError = result.error ?: "Could not start API session"
                stopSelf()
                return@execute
            }
            captureHandler.post {
                if (serviceDestroyed || mediaProjection == null) {
                    prefs.monitoringActive = false
                    if (!prefs.userRequestedStop) {
                        UnlockResumeCoordinator.markAwaitingResume(this)
                    } else {
                        prefs.monitoringError = "Screen sharing ended before monitoring could begin."
                        uploadExecutor.execute { api.stop(mobileToken) }
                    }
                    stopSelf()
                    return@post
                }
                capturesEnabled = true
                consecutiveCaptureMisses = 0
                captureHandler.removeCallbacks(captureRunnable)
                captureHandler.postDelayed(captureRunnable, FIRST_CAPTURE_DELAY_MS)
            }
        }
    }

    private fun ensureApiSession(
        mobileToken: String,
        goal: String,
        intervalMinutes: Int,
        reattach: Boolean
    ): ApiResult {
        if (!reattach) {
            return api.start(mobileToken, goal, intervalMinutes)
        }
        val status = api.status(mobileToken)
        if (!status.ok) {
            return api.start(mobileToken, goal, intervalMinutes)
        }
        val sessionStatus = try {
            org.json.JSONObject(status.body).optJSONObject("session")?.optString("status").orEmpty()
        } catch (_: Exception) {
            ""
        }
        return when (sessionStatus) {
            "active" -> ApiResult(true, status.body)
            "paused" -> {
                val resumed = api.resume(mobileToken)
                if (resumed.ok) resumed else api.start(mobileToken, goal, intervalMinutes)
            }
            else -> api.start(mobileToken, goal, intervalMinutes)
        }
    }

    private fun releaseCaptureResources() {
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
        runCatching { imageReader?.close() }
        imageReader = null
    }

    private fun setupVirtualDisplay() {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val screenWidth = metrics.widthPixels
        val screenHeight = metrics.heightPixels
        val captureScale = minOf(1f, MAX_CAPTURE_LONG_EDGE_PX.toFloat() / max(screenWidth, screenHeight))
        width = (screenWidth * captureScale).roundToInt().coerceAtLeast(1)
        height = (screenHeight * captureScale).roundToInt().coerceAtLeast(1)
        density = (metrics.densityDpi * captureScale).roundToInt().coerceAtLeast(1)
        imageReader = ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "SpaceLink Focus",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            captureHandler
        )
    }

    private fun captureFrame(): Boolean {
        val currentToken = token ?: return false
        val image = imageReader?.acquireLatestImage() ?: return false
        var sourceBitmap: Bitmap? = null
        var frameBitmap: Bitmap? = null
        try {
            val plane = image.planes.firstOrNull() ?: return false
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * width
            val bufferWidth = width + rowPadding / pixelStride
            sourceBitmap = Bitmap.createBitmap(bufferWidth, height, Bitmap.Config.ARGB_8888)
            val buffer: ByteBuffer = plane.buffer
            sourceBitmap.copyPixelsFromBuffer(buffer)
            frameBitmap = if (bufferWidth == width) {
                sourceBitmap
            } else {
                Bitmap.createBitmap(sourceBitmap, 0, 0, width, height)
            }
            if (frameBitmap !== sourceBitmap) {
                sourceBitmap.recycle()
                sourceBitmap = null
            }
            val capturedAt = Instant.now().toString()
            val frameToUpload = frameBitmap ?: return false
            frameBitmap = null
            uploadExecutor.execute {
                try {
                    val response = api.uploadScreenshot(currentToken, frameToUpload, capturedAt)
                    if (response.ok) {
                        prefs.lastUploadAt = capturedAt
                        prefs.monitoringError = null
                    } else {
                        val message = response.error ?: "Unknown upload error"
                        prefs.monitoringError = "Screenshot upload failed: $message"
                        android.util.Log.w(TAG, "Screenshot upload failed: $message")
                    }
                } catch (error: Throwable) {
                    prefs.monitoringError =
                        "Screenshot upload failed: ${error.message ?: error.javaClass.simpleName}"
                    android.util.Log.e(TAG, "Screenshot upload failed", error)
                } finally {
                    frameToUpload.recycle()
                }
            }
            return true
        } catch (error: Throwable) {
            android.util.Log.e(TAG, "Could not capture screen frame", error)
            prefs.monitoringError =
                "Screen capture failed: ${error.message ?: error.javaClass.simpleName}"
            val sourceToRecycle = sourceBitmap
            val frameToRecycle = frameBitmap
            if (sourceToRecycle?.isRecycled == false) sourceToRecycle.recycle()
            if (frameToRecycle !== sourceToRecycle && frameToRecycle?.isRecycled == false) {
                frameToRecycle.recycle()
            }
            return false
        } finally {
            image.close()
        }
    }

    private fun buildNotification(paused: Boolean): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(
                if (paused) "SpaceLink monitoring is paused" else "SpaceLink monitoring is active"
            )
            .setContentText(
                if (paused) {
                    "Open SpaceLink Focus to resume screen checks."
                } else {
                    "A focus check will run every ${captureIntervalMs / 60_000L} minutes."
                }
            )
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
    }

    private fun updateNotification(paused: Boolean) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(paused))
    }

    private fun failAndStop(stage: String, error: Throwable) {
        android.util.Log.e(TAG, stage, error)
        runCatching {
            prefs.monitoringError = "$stage: ${error.message ?: error.javaClass.simpleName}"
            prefs.recordCrash(error)
            UnlockResumeCoordinator.clearAwaitingResume(this)
        }
        capturesEnabled = false
        stopSelf()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "SpaceLink focus monitoring",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when SpaceLink has permission to capture focus checks"
            }
        )
    }

    @Suppress("DEPRECATION")
    private fun readResultDataExtra(intent: Intent): Intent? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
    }

    override fun onDestroy() {
        serviceDestroyed = true
        val awaitingResume = ::prefs.isInitialized && prefs.awaitingResumeAfterLock
        if (::prefs.isInitialized && !awaitingResume) {
            prefs.monitoringActive = false
        }
        capturesEnabled = false
        if (::captureHandler.isInitialized) captureHandler.removeCallbacksAndMessages(null)
        releaseCaptureResources()
        val projection = mediaProjection
        mediaProjection = null
        // Avoid re-entrant onStop handling when we are already awaiting unlock resume.
        if (!awaitingResume && !handlingProjectionStop) {
            runCatching { projection?.stop() }
        }
        uploadExecutor.shutdownNow()
        if (::captureThread.isInitialized) captureThread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_TOKEN = "mobile_token"
        const val EXTRA_GOAL = "monitoring_goal"
        const val EXTRA_INTERVAL_MINUTES = "interval_minutes"
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_RESULT_DATA = "projection_result_data"
        const val EXTRA_REATTACH_SESSION = "reattach_session"
        const val ACTION_PAUSE = "com.deadlineai.monitor.PAUSE"
        const val ACTION_RESUME = "com.deadlineai.monitor.RESUME"
        const val ACTION_CANCEL_AND_STOP = "com.deadlineai.monitor.CANCEL_AND_STOP"
        private const val TAG = "SpaceLinkCapture"
        private const val CHANNEL_ID = "spacelink_focus_monitoring"
        private const val NOTIFICATION_ID = 4182
        private const val FIRST_CAPTURE_DELAY_MS = 2_000L
        private const val CAPTURE_RETRY_DELAY_MS = 2_000L
        private const val MAX_CAPTURE_RETRIES = 3
        private const val MAX_CAPTURE_LONG_EDGE_PX = 1_600
        private const val DEFAULT_INTERVAL_MINUTES = 60
        private const val DEFAULT_CAPTURE_INTERVAL_MS = DEFAULT_INTERVAL_MINUTES * 60_000L
    }
}
