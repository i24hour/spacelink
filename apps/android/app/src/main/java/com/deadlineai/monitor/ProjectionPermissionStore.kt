package com.deadlineai.monitor

import android.content.Intent

data class ProjectionPermission(
    val resultCode: Int,
    val resultData: Intent
)

object ProjectionPermissionStore {
    private var pending: ProjectionPermission? = null

    @Synchronized
    fun put(resultCode: Int, resultData: Intent) {
        pending = ProjectionPermission(resultCode, resultData)
    }

    @Synchronized
    fun peek(): ProjectionPermission? = pending

    @Synchronized
    fun take(): ProjectionPermission? {
        val permission = pending
        pending = null
        return permission
    }

    @Synchronized
    fun clear() {
        pending = null
    }
}
