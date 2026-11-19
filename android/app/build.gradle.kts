// Modified for StartupBot; original copyright and license retained.
import java.util.Properties

plugins {
    id("com.android.application")
    kotlin("plugin.compose")
    kotlin("plugin.serialization")
}

// Release signing credentials must remain outside version control.
private val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.isFile) file.inputStream().use(::load)
}

private fun signingMaterial(property: String, environment: String): String? =
    (System.getenv(environment) ?: keystoreProperties.getProperty(property))
        ?.takeIf(String::isNotBlank)

private val storeFilePath = signingMaterial("storeFile", "STARTUPBOT_KEYSTORE_FILE")
private val storePasswordValue = signingMaterial("storePassword", "STARTUPBOT_KEYSTORE_PASSWORD")
private val keyAliasValue = signingMaterial("keyAlias", "STARTUPBOT_KEY_ALIAS")
// PKCS12 keystores use the same password for the store and key.
private val keyPasswordValue =
    signingMaterial("keyPassword", "STARTUPBOT_KEY_PASSWORD") ?: storePasswordValue

private val releaseSigningMaterial = mapOf(
    "storeFile / STARTUPBOT_KEYSTORE_FILE" to storeFilePath,
    "storePassword / STARTUPBOT_KEYSTORE_PASSWORD" to storePasswordValue,
    "keyAlias / STARTUPBOT_KEY_ALIAS" to keyAliasValue,
)
private val releaseKeystore: java.io.File? = when {
    releaseSigningMaterial.values.all { it == null } -> null
    releaseSigningMaterial.values.any { it == null } -> error(
        releaseSigningMaterial.filterValues { it == null }.keys.joinToString(
            prefix = "Release signing is half-configured. Missing: ",
            separator = ", ",
            postfix = ". Supply all of it, or none of it for an unsigned build.",
        )
    )
    else -> rootProject.file(storeFilePath!!).also {
        if (!it.isFile) error("Release keystore not found at ${it.absolutePath}.")
    }
}

private val appVersionName = "1.0.0"

private val appVersionCode = run {
    val parts = appVersionName.split(".").map { it.toIntOrNull() ?: -1 }
    check(parts.size == 3 && parts.all { it in 0..99 }) {
        "versionName must be MAJOR.MINOR.PATCH with each part in 0..99 for a " +
            "versionCode to be derived from it; got \"$appVersionName\"."
    }
    parts[0] * 10_000 + parts[1] * 100 + parts[2]
}

android {
    namespace = "com.openmausbot.companion"
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.startupbot.android"
        minSdk = 26
        targetSdk = 37
        versionCode = appVersionCode
        versionName = appVersionName
    }

    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
            isUniversalApk = true
        }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = storePasswordValue
                keyAlias = keyAliasValue
                keyPassword = keyPasswordValue
                // APK Signature Scheme v2 supports Android 7+; v3 supports signing-key rotation.
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        create("preview") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-threads-preview"
            matchingFallbacks += "debug"
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            signingConfig = signingConfigs.findByName("release")

            isMinifyEnabled = false
            // Android Gradle Plugin requires code shrinking before resource shrinking.
            isShrinkResources = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":core"))

    val composeBom = platform("androidx.compose:compose-bom:2025.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-process:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.security:security-crypto:1.1.0-alpha07")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    implementation("androidx.browser:browser:1.9.0")

    implementation("androidx.camera:camera-core:1.5.0")
    implementation("androidx.camera:camera-camera2:1.5.0")
    implementation("androidx.camera:camera-lifecycle:1.5.0")
    implementation("androidx.camera:camera-view:1.5.0")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.2.21")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation(composeBom)
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
