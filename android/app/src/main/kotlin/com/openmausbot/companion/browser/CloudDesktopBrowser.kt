// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.browser

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import java.net.URI

// Provider session URLs must not be persisted or logged. External browser origin and credential isolation are required.
class CloudDesktopBrowser(private val context: Context) {

    fun open(url: URI): String? = try {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setUrlBarHidingEnabled(true)
            .build()
            .launchUrl(context, Uri.parse(url.toASCIIString()))
        null
    } catch (error: Exception) {
        "This phone has no browser available to open the cloud desktop."
    }
}
