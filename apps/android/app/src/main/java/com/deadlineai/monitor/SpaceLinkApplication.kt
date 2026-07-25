package com.deadlineai.monitor

import android.app.Application

class SpaceLinkApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { AppPrefs(this).recordCrash(throwable) }
            previousHandler?.uncaughtException(thread, throwable)
        }
    }
}
