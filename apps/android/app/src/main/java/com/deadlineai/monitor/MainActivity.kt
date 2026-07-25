package com.deadlineai.monitor

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Bundle
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = AppPrefs(this)
        api = ApiClient()
        requestNotificationPermissionIfNeeded()
        setContentView(buildView())
        updateControls()
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
        content.addView(label("Privacy: SpaceLink uses a temporary screenshot for analysis and does not retain the raw image by default. Android will show a visible screen-capture notification while monitoring is active.", 13f))

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

    private fun requestScreenCapture() {
        val token = prefs.mobileToken
        val goal = goalInput.text.toString().trim()
        if (token == null) {
            toast("Pair this phone first")
            return
        }
        if (goal.length < 3) {
            toast("Enter a goal first")
            return
        }
        pendingGoal = goal
        prefs.intervalMinutes = selectedIntervalMinutes()
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
    }

    @Deprecated("Android activity result API retained for broad device compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        if (resultCode != RESULT_OK || data == null) {
            toast("Screen capture permission was not granted")
            return
        }
        prefs.goal = pendingGoal
        setBusy(true)
        io.execute {
            val intervalMinutes = prefs.intervalMinutes
            val result = api.start(requireToken(), pendingGoal, intervalMinutes)
            runOnUiThread {
                setBusy(false)
                if (!result.ok) {
                    toast(result.error ?: "Could not start monitoring")
                    return@runOnUiThread
                }
                val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
                    putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                    putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
                    putExtra(ScreenCaptureService.EXTRA_TOKEN, requireToken())
                    putExtra(ScreenCaptureService.EXTRA_INTERVAL_MINUTES, intervalMinutes)
                }
                androidxStartForegroundService(serviceIntent)
                isPaused = false
                pauseButton.text = "Pause monitoring"
                updateControls()
                statusText.text = "Monitoring active. The first check will run shortly, then every $intervalMinutes minutes."
            }
        }
    }

    private fun stopMonitoring() {
        val token = prefs.mobileToken ?: return
        io.execute {
            val result = api.stop(token)
            runOnUiThread {
                stopService(Intent(this, ScreenCaptureService::class.java))
                isPaused = false
                pauseButton.text = "Pause monitoring"
                statusText.text = if (result.ok) "Monitoring stopped." else result.error ?: "Stop failed"
                updateControls()
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
                } else if (result.ok && name == "resume") {
                    sendServiceAction(ScreenCaptureService.ACTION_RESUME)
                    isPaused = false
                    pauseButton.text = "Pause monitoring"
                }
            }
        }
    }

    private fun requireToken(): String = prefs.mobileToken ?: error("Pair this phone first")

    private fun sendServiceAction(action: String) {
        startService(Intent(this, ScreenCaptureService::class.java).setAction(action))
    }

    private fun selectedIntervalMinutes(): Int {
        if (!::intervalSpinner.isInitialized) return prefs.intervalMinutes
        return intervalOptions()[intervalSpinner.selectedItemPosition]
    }

    private fun intervalOptions(): List<Int> = (5..60 step 5).toList()

    private fun updateControls() {
        if (!::startButton.isInitialized) return
        val paired = prefs.mobileToken != null
        pairButton.isEnabled = true
        pairingCodeInput.isEnabled = true
        startButton.isEnabled = paired
        pauseButton.isEnabled = paired
        stopButton.isEnabled = paired
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
            startButton.isEnabled = !busy && prefs.mobileToken != null
            pauseButton.isEnabled = !busy && prefs.mobileToken != null
            stopButton.isEnabled = !busy && prefs.mobileToken != null
            if (busy) statusText.text = "Working..."
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
