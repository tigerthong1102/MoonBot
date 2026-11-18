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
        mavenCentral()
    }
}

rootProject.name = "startupbot-android"
include(":core")
include(":app")
