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
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"

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

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}
