import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.deadlineai.monitor"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.deadlineai.monitor"
        minSdk = 29
        // Keep compileSdk current, but target 34 so Android 15/16 mediaProjection FGS
        // checks match the documented grant-then-startForeground contract more reliably.
        targetSdk = 34
        versionCode = 15
        versionName = "0.2.4"

        buildConfigField("String", "API_BASE_URL", "\"https://deadlineai-api.onrender.com\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    base {
        archivesName.set("spacelink-focus-0.2.4")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
