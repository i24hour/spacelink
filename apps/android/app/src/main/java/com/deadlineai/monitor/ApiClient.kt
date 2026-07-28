package com.deadlineai.monitor

import android.graphics.Bitmap
import android.util.Base64
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

data class ApiResult(val ok: Boolean, val body: String, val error: String? = null)

class ApiClient {
    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')

    fun exchangePairingCode(code: String, deviceName: String): String {
        val response = request(
            "POST",
            "/api/mobile/exchange",
            body = JSONObject().apply {
                put("code", code)
                put("deviceName", deviceName)
            }.toString()
        )
        if (!response.ok) throw IllegalStateException(response.error ?: "Pairing failed")
        return JSONObject(response.body).getString("token")
    }

    fun start(token: String, goal: String, intervalMinutes: Int = 60): ApiResult =
        request(
            "POST",
            "/api/mobile/start",
            token,
            JSONObject().apply {
                put("goal", goal)
                put("intervalMinutes", intervalMinutes)
            }.toString()
        )

    fun pause(token: String): ApiResult = request("POST", "/api/mobile/pause", token)
    fun resume(token: String): ApiResult = request("POST", "/api/mobile/resume", token)
    fun stop(token: String): ApiResult = request("POST", "/api/mobile/stop", token)
    fun status(token: String): ApiResult = request("GET", "/api/mobile/status", token)

    fun uploadScreenshot(token: String, bitmap: Bitmap, capturedAt: String): ApiResult {
        val output = java.io.ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 72, output)) {
            return ApiResult(false, "", "Could not encode screenshot")
        }
        return requestBytes(
            "POST",
            "/api/mobile/screen-check",
            token,
            output.toByteArray(),
            "image/jpeg",
            capturedAt
        )
    }

    private fun request(
        method: String,
        path: String,
        token: String? = null,
        body: String? = null
    ): ApiResult {
        return requestBytes(
            method,
            path,
            token,
            body?.toByteArray(StandardCharsets.UTF_8),
            if (body != null) "application/json" else null,
            null
        )
    }

    private fun requestBytes(
        method: String,
        path: String,
        token: String?,
        body: ByteArray?,
        contentType: String?,
        capturedAt: String?
    ): ApiResult {
        val connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20_000
            readTimeout = 90_000
            doInput = true
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (contentType != null) setRequestProperty("Content-Type", contentType)
            if (capturedAt != null) setRequestProperty("X-Captured-At", capturedAt)
            if (body != null) {
                doOutput = true
                setFixedLengthStreamingMode(body.size)
            }
        }

        return try {
            if (body != null) connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.use {
                BufferedReader(InputStreamReader(BufferedInputStream(it), StandardCharsets.UTF_8)).readText()
            } ?: ""
            if (status in 200..299) ApiResult(true, responseBody) else {
                ApiResult(false, responseBody, parseError(responseBody, status))
            }
        } catch (error: Exception) {
            ApiResult(false, "", error.message ?: "Network request failed")
        } finally {
            connection.disconnect()
        }
    }

    private fun parseError(body: String, status: Int): String {
        val lower = body.lowercase()
        if (status == 503 || lower.contains("service suspended") || lower.contains("suspended")) {
            return "API is suspended or unavailable (HTTP $status). Check Render billing / free-tier limits."
        }
        return try {
            JSONObject(body).optString("error").ifBlank { "Request failed ($status)" }
        } catch (_: Exception) {
            if (body.contains("Service Suspended", ignoreCase = true)) {
                "API is suspended or unavailable (HTTP $status). Check Render billing / free-tier limits."
            } else {
                "Request failed ($status)"
            }
        }
    }
}
