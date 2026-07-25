package com.deadlineai.monitor

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
    @Volatile
    private var serviceDestroyed = false

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
        }
        if (mediaProjection != null) return START_NOT_STICKY
        val projectionPermission = ProjectionPermissionStore.take()
        val resultCode = projectionPermission?.resultCode ?: -1
        val resultData = projectionPermission?.resultData
        token = intent?.getStringExtra(EXTRA_TOKEN)
        val goal = intent?.getStringExtra(EXTRA_GOAL)?.trim()
        val intervalMinutes = intent?.getIntExtra(
            EXTRA_INTERVAL_MINUTES,
            DEFAULT_INTERVAL_MINUTES
        ) ?: DEFAULT_INTERVAL_MINUTES
        captureIntervalMs = intervalMinutes.coerceIn(5, 60) * 60_000L
        val missingFields = buildList {
            if (projectionPermission == null) add("projection permission")
            if (resultCode == -1) add("result code")
            if (resultData == null) add("result data")
            if (token.isNullOrBlank()) add("phone token")
            if (goal.isNullOrBlank()) add("goal")
        }
        if (missingFields.isNotEmpty()) {
            prefs.monitoringError = "Monitoring could not start; missing ${missingFields.joinToString()}."
            stopSelf()
            return START_NOT_STICKY
        }
        val grantedResultData = requireNotNull(resultData)
        val monitoringGoal = requireNotNull(goal)

        updateNotification(paused = false)
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = manager.getMediaProjection(resultCode, grantedResultData)
            ?: throw IllegalStateException("MediaProjection was not granted")
        mediaProjection = projection
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                stopSelf()
            }
        }, captureHandler)
        setupVirtualDisplay()
        prefs.monitoringActive = true
        prefs.monitoringError = null
        prefs.lastCrash = null
        startApiSessionAndCaptures(token as String, monitoringGoal, intervalMinutes)
        return START_NOT_STICKY
    }

    private fun startApiSessionAndCaptures(
        mobileToken: String,
        goal: String,
        intervalMinutes: Int
    ) {
        uploadExecutor.execute {
            val result = try {
                api.start(mobileToken, goal, intervalMinutes)
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
                    prefs.monitoringError = "Screen sharing ended before monitoring could begin."
                    uploadExecutor.execute { api.stop(mobileToken) }
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

    override fun onDestroy() {
        serviceDestroyed = true
        if (::prefs.isInitialized) prefs.monitoringActive = false
        capturesEnabled = false
        if (::captureHandler.isInitialized) captureHandler.removeCallbacksAndMessages(null)
        runCatching { virtualDisplay?.release() }
        runCatching { imageReader?.close() }
        runCatching { mediaProjection?.stop() }
        uploadExecutor.shutdownNow()
        if (::captureThread.isInitialized) captureThread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_TOKEN = "mobile_token"
        const val EXTRA_GOAL = "monitoring_goal"
        const val EXTRA_INTERVAL_MINUTES = "interval_minutes"
        const val ACTION_PAUSE = "com.deadlineai.monitor.PAUSE"
        const val ACTION_RESUME = "com.deadlineai.monitor.RESUME"
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
