// The Game Night TV app: a full-screen WebView on the game select page, with the game-night
// server running alongside it. Built by `make android` (scripts/android.sh), which first puts
// the server binaries in src/main/jniLibs and the web files in src/main/assets/web.zip.
plugins {
    id("com.android.application")
}

// set by scripts/android.sh from the git tag
val gnVersionName = providers.gradleProperty("gnVersionName").getOrElse("dev")
val gnVersionCode = providers.gradleProperty("gnVersionCode").getOrElse("1").toInt()

android {
    namespace = "com.beaconengine.gamenight"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.beaconengine.gamenight"
        minSdk = 26
        targetSdk = 36
        versionName = gnVersionName
        versionCode = gnVersionCode
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so it can be sideloaded; use a real key before any store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    // The server is an executable shipped as a native library (the one place Android lets an app
    // run its own binaries from), so it has to be unpacked on install.
    packaging {
        jniLibs { useLegacyPackaging = true }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
