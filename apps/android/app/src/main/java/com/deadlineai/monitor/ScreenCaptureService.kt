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
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import java.nio.ByteBuffer
import java.time.Instant
import java.util.concurrent.Executors

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

    private val captureRunnable = object : Runnable {
        override fun run() {
            if (!capturesEnabled) return
            val captured = captureFrame()
            if (capturesEnabled) {
                captureHandler.postDelayed(
                    this,
                    if (captured) captureIntervalMs else CAPTURE_RETRY_DELAY_MS
                )
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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_BEGIN_CAPTURES -> {
                if (mediaProjection != null) {
                    capturesEnabled = true
                    captureHandler.removeCallbacks(captureRunnable)
                    captureHandler.postDelayed(captureRunnable, FIRST_CAPTURE_DELAY_MS)
                } else {
                    prefs.monitoringError = "Screen-capture session was not available."
                    stopSelf()
                }
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                capturesEnabled = false
                captureHandler.removeCallbacks(captureRunnable)
                updateNotification(paused = true)
                return START_NOT_STICKY
            }
            ACTION_RESUME -> {
                if (mediaProjection != null) {
                    capturesEnabled = true
                    captureHandler.removeCallbacks(captureRunnable)
                    captureHandler.postDelayed(captureRunnable, captureIntervalMs)
                    updateNotification(paused = false)
                }
                return START_NOT_STICKY
            }
        }
        if (mediaProjection != null) return START_NOT_STICKY
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
        val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        token = intent?.getStringExtra(EXTRA_TOKEN)
        val intervalMinutes = intent?.getIntExtra(
            EXTRA_INTERVAL_MINUTES,
            DEFAULT_INTERVAL_MINUTES
        ) ?: DEFAULT_INTERVAL_MINUTES
        captureIntervalMs = intervalMinutes.coerceIn(5, 60) * 60_000L
        if (resultCode == -1 || resultData == null || token.isNullOrBlank()) {
            prefs.monitoringError = "Screen-capture permission data was missing."
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(paused = false),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val projection = manager.getMediaProjection(resultCode, resultData)
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
        } catch (error: Exception) {
            android.util.Log.e(TAG, "Could not start screen capture", error)
            prefs.monitoringError = "Screen capture setup failed: ${error.message ?: error.javaClass.simpleName}"
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun setupVirtualDisplay() {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        width = metrics.widthPixels
        height = metrics.heightPixels
        density = metrics.densityDpi
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
                } catch (error: Exception) {
                    prefs.monitoringError =
                        "Screenshot upload failed: ${error.message ?: error.javaClass.simpleName}"
                    android.util.Log.e(TAG, "Screenshot upload failed", error)
                } finally {
                    frameToUpload.recycle()
                }
            }
            return true
        } catch (error: Exception) {
            android.util.Log.e(TAG, "Could not capture screen frame", error)
            prefs.monitoringError =
                "Screen capture failed: ${error.message ?: error.javaClass.simpleName}"
            sourceBitmap?.recycle()
            frameBitmap?.recycle()
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
        if (::prefs.isInitialized) prefs.monitoringActive = false
        capturesEnabled = false
        captureHandler.removeCallbacksAndMessages(null)
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
        uploadExecutor.shutdownNow()
        captureThread.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        const val EXTRA_TOKEN = "mobile_token"
        const val EXTRA_INTERVAL_MINUTES = "interval_minutes"
        const val ACTION_BEGIN_CAPTURES = "com.deadlineai.monitor.BEGIN_CAPTURES"
        const val ACTION_PAUSE = "com.deadlineai.monitor.PAUSE"
        const val ACTION_RESUME = "com.deadlineai.monitor.RESUME"
        private const val TAG = "SpaceLinkCapture"
        private const val CHANNEL_ID = "spacelink_focus_monitoring"
        private const val NOTIFICATION_ID = 4182
        private const val FIRST_CAPTURE_DELAY_MS = 2_000L
        private const val CAPTURE_RETRY_DELAY_MS = 750L
        private const val DEFAULT_INTERVAL_MINUTES = 60
        private const val DEFAULT_CAPTURE_INTERVAL_MS = DEFAULT_INTERVAL_MINUTES * 60_000L
    }
}
