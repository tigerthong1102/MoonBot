// Modified for StartupBot; original copyright and license retained.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        // The public Central endpoint can rate-limit the large Robolectric test runtime on CI.
        maven(providers.gradleProperty("robolectricMavenMirror").get()) {
            content { includeVersion("org.robolectric", "nativeruntime-dist-compat", "1.0.18") }
        }
        mavenCentral()
    }
}

rootProject.name = "startupbot-android"
include(":core")
include(":app")
