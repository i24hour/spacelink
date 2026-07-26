package com.deadlineai.monitor

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var prefs: AppPrefs
    private lateinit var api: ApiClient
    private lateinit var pairingCodeInput: EditText
    private lateinit var goalInput: EditText
    private lateinit var intervalSpinner: Spinner
    private lateinit var statusText: TextView
    private lateinit var pairButton: Button
    private lateinit var startButton: Button
    private lateinit var pauseButton: Button
    private lateinit var stopButton: Button
    private var pendingGoal = ""
    private var isPaused = false
    private var currentSessionStatus = ""
    private var capturePromptInFlight = false
    private var suppressAutoResumeUntilElapsed = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = AppPrefs(this)
        api = ApiClient()
        requestNotificationPermissionIfNeeded()
        setContentView(buildView())
        updateControls()
        prefs.lastCrash?.let {
            statusText.text = "Previous app crash: $it"
        }
        maybeAutoResumeCapture(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        maybeAutoResumeCapture(intent)
    }

    override fun onResume() {
        super.onResume()
        if (::statusText.isInitialized && prefs.mobileToken != null) {
            refreshMonitoringStatus()
        }
        maybeAutoResumeCapture(intent)
    }

    private fun buildView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 36, 32, 32)
        }
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(content)

        content.addView(label("SpaceLink Focus Monitor", 26f))
        content.addView(label("Custom phone focus checks sent to your connected Telegram chat.", 15f))
        content.addView(spacer(20))

        content.addView(label("1. Pair this phone", 19f))
        pairingCodeInput = EditText(this).apply {
            hint = "Six-digit code from SpaceLink Settings"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            maxLines = 1
        }
        content.addView(pairingCodeInput, fieldParams())
        pairButton = Button(this).apply {
            text = "Pair phone"
            setOnClickListener { pairPhone() }
        }
        content.addView(pairButton, buttonParams())

        content.addView(spacer(20))
        content.addView(label("2. Set your current goal", 19f))
        goalInput = EditText(this).apply {
            hint = "Example: Prepare for tomorrow's exam"
            minLines = 2
            gravity = Gravity.TOP
            setText(prefs.goal)
        }
        content.addView(goalInput, fieldParams())

        content.addView(spacer(12))
        content.addView(label("3. Choose check-in interval", 19f))
        content.addView(label("Shorter intervals use more battery and LLM credits.", 14f))
        intervalSpinner = Spinner(this).apply {
            val values = intervalOptions().map { "$it minutes" }
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_item,
                values
            ).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
            setSelection(intervalOptions().indexOf(prefs.intervalMinutes).coerceAtLeast(0))
            onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit

                override fun onItemSelected(
                    parent: android.widget.AdapterView<*>?,
                    view: View?,
                    position: Int,
                    id: Long
                ) {
                    prefs.intervalMinutes = intervalOptions()[position]
                }
            }
        }
        content.addView(intervalSpinner, fieldParams())

        content.addView(spacer(12))
        startButton = Button(this).apply {
            text = "Start monitoring"
            setOnClickListener { requestScreenCapture() }
        }
        pauseButton = Button(this).apply {
            text = "Pause monitoring"
            setOnClickListener {
                if (isPaused) {
                    runAction("resume") { api.resume(requireToken()) }
                } else {
                    runAction("pause") { api.pause(requireToken()) }
                }
            }
        }
        stopButton = Button(this).apply {
            text = "Stop monitoring"
            setOnClickListener { stopMonitoring() }
        }
        content.addView(startButton, buttonParams())
        content.addView(pauseButton, buttonParams())
        content.addView(stopButton, buttonParams())

        statusText = label("Not paired", 14f)
        statusText.setPadding(0, 20, 0, 0)
        content.addView(statusText)
        content.addView(spacer(16))
        content.addView(
            label(
                "Privacy: SpaceLink uses a temporary screenshot for analysis and does not retain the raw image by default. Android stops screen capture when the phone is locked; after unlock, SpaceLink will ask you to allow capture again to continue.",
                13f
            )
        )

        root.addView(scroll, LinearLayout.LayoutParams(-1, -1))
        return root
    }

    private fun pairPhone() {
        val code = pairingCodeInput.text.toString().trim()
        if (!code.matches(Regex("\\d{6}"))) {
            toast("Enter the six-digit pairing code")
            return
        }
        setBusy(true)
        io.execute {
            try {
                val token = api.exchangePairingCode(code, android.os.Build.MODEL)
                prefs.mobileToken = token
                runOnUiThread {
                    setBusy(false)
                    pairingCodeInput.text.clear()
                    updateControls()
                    toast("Phone paired successfully")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    setBusy(false)
                    toast(error.message ?: "Pairing failed")
                }
            }
        }
    }

    private fun maybeAutoResumeCapture(intent: Intent?) {
        if (!::prefs.isInitialized || !::statusText.isInitialized) return
        if (capturePromptInFlight || prefs.monitoringActive) return
        val requested = intent?.getBooleanExtra(
            UnlockResumeCoordinator.EXTRA_AUTO_RESUME_CAPTURE,
            false
        ) == true
        if (requested) {
            intent?.removeExtra(UnlockResumeCoordinator.EXTRA_AUTO_RESUME_CAPTURE)
        }
        if (!requested && !prefs.awaitingResumeAfterLock) return
        if (!requested && SystemClock.elapsedRealtime() < suppressAutoResumeUntilElapsed) {
            statusText.text =
                "Screen was locked. Tap Continue monitoring and allow screen capture to resume."
            return
        }
        if (isKeyguardLocked()) {
            statusText.text =
                "Screen was locked. Unlock your phone — SpaceLink will ask to continue monitoring."
            return
        }
        if (prefs.mobileToken == null) return
        val goal = goalInput.text.toString().trim().ifBlank { prefs.goal.trim() }
        if (goal.length < 3) {
            statusText.text = "Saved goal missing. Enter a goal, then tap Start monitoring."
            return
        }
        if (::goalInput.isInitialized && goalInput.text.toString().trim().isEmpty()) {
            goalInput.setText(prefs.goal)
        }
        statusText.text = "Phone unlocked. Allow screen capture to continue monitoring..."
        requestScreenCapture(autoResume = true)
    }

    private fun requestScreenCapture(autoResume: Boolean = false) {
        if (capturePromptInFlight) return
        val token = prefs.mobileToken
        val goal = goalInput.text.toString().trim().ifBlank { prefs.goal.trim() }
        if (token == null) {
            toast("Pair this phone first")
            return
        }
        if (goal.length < 3) {
            toast("Enter a goal first")
            return
        }
        pendingGoal = goal
        prefs.goal = goal
        prefs.intervalMinutes = selectedIntervalMinutes()
        try {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
                ?: throw IllegalStateException("Android screen-capture service is unavailable")
            statusText.text = if (autoResume) {
                "Phone unlocked. Waiting for Android screen-capture permission..."
            } else {
                "Waiting for Android screen-capture permission..."
            }
            startButton.isEnabled = false
            capturePromptInFlight = true
            val captureIntent = if (android.os.Build.VERSION.SDK_INT >= 34) {
                manager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay()
                )
            } else {
                manager.createScreenCaptureIntent()
            }
            startActivityForResult(captureIntent, REQUEST_CAPTURE)
        } catch (error: Exception) {
            capturePromptInFlight = false
            updateControls()
            statusText.text = "Android could not open the screen-capture permission dialog."
            toast(error.message ?: "Could not request screen capture")
        }
    }

    @Deprecated("Android activity result API retained for broad device compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        capturePromptInFlight = false
        if (resultCode != RESULT_OK || data == null) {
            updateControls()
            if (prefs.awaitingResumeAfterLock || pendingGoal.isNotBlank()) {
                UnlockResumeCoordinator.markAwaitingResume(this)
                suppressAutoResumeUntilElapsed = SystemClock.elapsedRealtime() + 60_000L
                statusText.text =
                    "Screen-capture permission was denied. Tap Continue monitoring to try again."
            } else {
                statusText.text = "Screen-capture permission was denied. Monitoring did not start."
            }
            toast("Screen capture permission was not granted")
            return
        }
        val mobileToken = prefs.mobileToken
        if (mobileToken == null) {
            updateControls()
            toast("Pair this phone first")
            return
        }
        prefs.goal = pendingGoal
        val intervalMinutes = prefs.intervalMinutes
        val reattach = prefs.awaitingResumeAfterLock
        ProjectionPermissionStore.put(resultCode, data)
        val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_TOKEN, mobileToken)
            putExtra(ScreenCaptureService.EXTRA_GOAL, pendingGoal)
            putExtra(ScreenCaptureService.EXTRA_INTERVAL_MINUTES, intervalMinutes)
            // RESULT_OK is -1; pass explicitly so the service never treats success as "missing".
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_REATTACH_SESSION, reattach)
        }
        try {
            prefs.userRequestedStop = false
            prefs.monitoringError = null
            prefs.lastCrash = null
            androidxStartForegroundService(serviceIntent)
            prefs.monitoringActive = true
            UnlockResumeCoordinator.clearAwaitingResume(this)
        } catch (error: Exception) {
            ProjectionPermissionStore.clear()
            prefs.monitoringActive = false
            prefs.monitoringError =
                "Foreground service failed: ${error.message ?: error.javaClass.simpleName}"
            updateControls()
            statusText.text = "Could not start the Android screen-capture service."
            toast(error.message ?: "Could not start screen capture")
            return
        }

        isPaused = false
        pauseButton.text = "Pause monitoring"
        applySessionControls("active")
        statusText.text = if (reattach) {
            "Screen permission granted again. Continuing monitoring..."
        } else {
            "Screen permission granted. Starting monitoring and the first check..."
        }
        statusText.postDelayed({ refreshMonitoringStatus() }, 2_000L)
    }

    private fun stopMonitoring() {
        val token = prefs.mobileToken ?: return
        prefs.userRequestedStop = true
        UnlockResumeCoordinator.clearAwaitingResume(this)
        startService(
            Intent(this, ScreenCaptureService::class.java)
                .setAction(ScreenCaptureService.ACTION_CANCEL_AND_STOP)
        )
        io.execute {
            val result = api.stop(token)
            runOnUiThread {
                stopService(Intent(this, ScreenCaptureService::class.java))
                prefs.monitoringActive = false
                prefs.awaitingResumeAfterLock = false
                isPaused = false
                pauseButton.text = "Pause monitoring"
                statusText.text = if (result.ok) "Monitoring stopped." else result.error ?: "Stop failed"
                applySessionControls("")
            }
        }
    }

    private fun runAction(name: String, action: () -> ApiResult) {
        setBusy(true)
        io.execute {
            val result = action()
            runOnUiThread {
                setBusy(false)
                statusText.text = if (result.ok) "Monitoring $name requested." else result.error ?: "Request failed"
                if (result.ok && name == "pause") {
                    sendServiceAction(ScreenCaptureService.ACTION_PAUSE)
                    isPaused = true
                    pauseButton.text = "Resume monitoring"
                    applySessionControls("paused")
                } else if (result.ok && name == "resume") {
                    sendServiceAction(ScreenCaptureService.ACTION_RESUME)
                    isPaused = false
                    pauseButton.text = "Pause monitoring"
                    applySessionControls("active")
                }
            }
        }
    }

    private fun requireToken(): String = prefs.mobileToken ?: error("Pair this phone first")

    private fun refreshMonitoringStatus() {
        val token = prefs.mobileToken ?: return
        io.execute {
            val result = api.status(token)
            runOnUiThread {
                if (!result.ok) {
                    statusText.text = "Paired locally, but the API status could not be checked."
                    return@runOnUiThread
                }
                val session = try {
                    org.json.JSONObject(result.body).optJSONObject("session")
                } catch (_: Exception) {
                    null
                }
                val sessionStatus = session?.optString("status").orEmpty()
                val lastCheck = session?.optString("lastCheckAt").orEmpty()
                    .replace("T", " ")
                    .removeSuffix(".000Z")
                val lastUpload = prefs.lastUploadAt.orEmpty()
                    .replace("T", " ")
                    .removeSuffix(".000Z")
                val lastKnownCheck = lastCheck.ifBlank { lastUpload }
                val lastError = prefs.monitoringError
                val lastCrash = prefs.lastCrash
                isPaused = sessionStatus == "paused"
                pauseButton.text = if (isPaused) "Resume monitoring" else "Pause monitoring"
                applySessionControls(sessionStatus)
                statusText.text = when {
                    prefs.awaitingResumeAfterLock ->
                        "Screen was locked, so Android stopped capture. Unlock and allow screen sharing to continue."
                    sessionStatus == "active" && prefs.monitoringActive ->
                        "Monitoring active. Last check: ${lastKnownCheck.ifBlank { "waiting for first check" }}"
                    sessionStatus == "active" ->
                        "API session is active, but screen capture is not running." +
                            (lastCrash?.let { " Last crash: $it" }
                                ?: lastError?.let { " Last error: $it" }
                                ?: " Tap Start Monitoring again.")
                    sessionStatus == "paused" ->
                        "Monitoring paused. Tap Resume monitoring to continue."
                    else -> lastCrash?.let { "Monitoring is stopped. Last crash: $it" }
                        ?: lastError?.let { "Monitoring is stopped. Last error: $it" }
                        ?: "Paired. No monitoring session is active."
                }
            }
        }
    }

    private fun sendServiceAction(action: String) {
        startService(Intent(this, ScreenCaptureService::class.java).setAction(action))
    }

    private fun selectedIntervalMinutes(): Int {
        if (!::intervalSpinner.isInitialized) return prefs.intervalMinutes
        return intervalOptions()[intervalSpinner.selectedItemPosition]
    }

    private fun intervalOptions(): List<Int> = (5..60 step 5).toList()

    private fun applySessionControls(sessionStatus: String) {
        currentSessionStatus = sessionStatus
        val paired = prefs.mobileToken != null
        val sessionExists = sessionStatus == "active" ||
            sessionStatus == "paused" ||
            prefs.awaitingResumeAfterLock
        val captureServiceRunning = sessionExists && prefs.monitoringActive
        startButton.isEnabled = paired && !captureServiceRunning
        startButton.text = if (prefs.awaitingResumeAfterLock && !captureServiceRunning) {
            "Continue monitoring"
        } else {
            "Start monitoring"
        }
        pauseButton.isEnabled = paired && captureServiceRunning
        stopButton.isEnabled = paired && sessionExists
        goalInput.isEnabled = !captureServiceRunning
        intervalSpinner.isEnabled = !captureServiceRunning
    }

    private fun isKeyguardLocked(): Boolean {
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        return keyguard.isKeyguardLocked
    }

    private fun updateControls() {
        if (!::startButton.isInitialized) return
        val paired = prefs.mobileToken != null
        pairButton.isEnabled = true
        pairingCodeInput.isEnabled = true
        applySessionControls(currentSessionStatus)
        statusText.text = if (paired) {
            "Paired. Enter a new code to replace this phone pairing."
        } else {
            "Not paired. Generate a code in SpaceLink Settings."
        }
    }

    private fun setBusy(busy: Boolean) {
        runOnUiThread {
            pairButton.isEnabled = !busy
            pairingCodeInput.isEnabled = !busy
            if (busy) {
                startButton.isEnabled = false
                pauseButton.isEnabled = false
                stopButton.isEnabled = false
                statusText.text = "Working..."
            } else {
                applySessionControls(currentSessionStatus)
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
    }

    private fun androidxStartForegroundService(intent: Intent) {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun label(text: String, size: Float) = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(0xff172033.toInt())
    }

    private fun spacer(height: Int) = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, height)
    }

    private fun fieldParams() = LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        topMargin = 8
    }

    private fun buttonParams() = LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        topMargin = 6
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_CAPTURE = 7001
        private const val REQUEST_NOTIFICATIONS = 7002
    }
}
