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

    private val captureRunnable = object : Runnable {
        override fun run() {
            captureFrame()
            captureHandler.postDelayed(this, captureIntervalMs)
        }
    }

    override fun onCreate() {
        super.onCreate()
        captureThread = HandlerThread("spacelink-screen-capture").also { it.start() }
        captureHandler = Handler(captureThread.looper)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> {
                captureHandler.removeCallbacks(captureRunnable)
                return START_NOT_STICKY
            }
            ACTION_RESUME -> {
                if (mediaProjection != null) {
                    captureHandler.removeCallbacks(captureRunnable)
                    captureHandler.postDelayed(captureRunnable, captureIntervalMs)
                }
                return START_NOT_STICKY
            }
        }
        if (mediaProjection != null) return START_NOT_STICKY
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
        val resultData = intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
        token = intent?.getStringExtra(EXTRA_TOKEN)
        val intervalMinutes = intent?.getIntExtra(
            EXTRA_INTERVAL_MINUTES,
            DEFAULT_INTERVAL_MINUTES
        ) ?: DEFAULT_INTERVAL_MINUTES
        captureIntervalMs = intervalMinutes.coerceIn(5, 60) * 60_000L
        if (resultCode == -1 || resultData == null || token.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(),
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
            captureHandler.removeCallbacks(captureRunnable)
            captureHandler.postDelayed(captureRunnable, FIRST_CAPTURE_DELAY_MS)
        } catch (error: Exception) {
            android.util.Log.e(TAG, "Could not start screen capture", error)
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

    private fun captureFrame() {
        val image = imageReader?.acquireLatestImage()
        if (image == null) {
            captureHandler.postDelayed({ captureFrame() }, 750L)
            return
        }
        try {
            val plane = image.planes.firstOrNull() ?: return
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * width
            val bufferWidth = width + rowPadding / pixelStride
            val bitmap = Bitmap.createBitmap(bufferWidth, height, Bitmap.Config.ARGB_8888)
            val buffer: ByteBuffer = plane.buffer
            bitmap.copyPixelsFromBuffer(buffer)
            val cropped = if (bufferWidth == width) bitmap else Bitmap.createBitmap(bitmap, 0, 0, width, height)
            if (cropped !== bitmap) bitmap.recycle()
            val capturedAt = Instant.now().toString()
            val currentToken = token ?: return
            uploadExecutor.execute {
                try {
                    val response = api.uploadScreenshot(currentToken, cropped, capturedAt)
                    if (!response.ok) android.util.Log.w(TAG, "Screenshot upload failed: ${response.error}")
                } finally {
                    cropped.recycle()
                }
            }
        } finally {
            image.close()
        }
    }

    private fun buildNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SpaceLink monitoring is active")
            .setContentText("A focus check will run every ${captureIntervalMs / 60_000L} minutes.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
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
        const val ACTION_PAUSE = "com.deadlineai.monitor.PAUSE"
        const val ACTION_RESUME = "com.deadlineai.monitor.RESUME"
        private const val TAG = "SpaceLinkCapture"
        private const val CHANNEL_ID = "spacelink_focus_monitoring"
        private const val NOTIFICATION_ID = 4182
        private const val FIRST_CAPTURE_DELAY_MS = 2_000L
        private const val DEFAULT_INTERVAL_MINUTES = 60
        private const val DEFAULT_CAPTURE_INTERVAL_MS = DEFAULT_INTERVAL_MINUTES * 60_000L
    }
}
