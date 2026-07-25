package com.deadlineai.monitor

import android.content.Context

class AppPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("spacelink_focus", Context.MODE_PRIVATE)

    var mobileToken: String?
        get() = prefs.getString("mobile_token", null)
        set(value) = prefs.edit().putString("mobile_token", value).apply()

    var goal: String
        get() = prefs.getString("goal", "") ?: ""
        set(value) = prefs.edit().putString("goal", value).apply()

    var intervalMinutes: Int
        get() = prefs.getInt("interval_minutes", 60).coerceIn(5, 60)
        set(value) = prefs.edit().putInt("interval_minutes", value.coerceIn(5, 60)).apply()

    var monitoringActive: Boolean
        get() = prefs.getBoolean("monitoring_active", false)
        set(value) = prefs.edit().putBoolean("monitoring_active", value).apply()

    var monitoringError: String?
        get() = prefs.getString("monitoring_error", null)
        set(value) = prefs.edit().putString("monitoring_error", value).apply()

    var lastUploadAt: String?
        get() = prefs.getString("last_upload_at", null)
        set(value) = prefs.edit().putString("last_upload_at", value).apply()

    fun clearToken() {
        prefs.edit().remove("mobile_token").apply()
    }
}
