package com.openmausbot.companion.ui

import android.content.ActivityNotFoundException
import android.widget.Toast
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.openmausbot.companion.R

@Composable
internal fun mobileChatOrigin() = personalInboxOrigin(stringResource(R.string.startupbot_mobile_origin))

@Composable
internal fun MobileChatButton() {
    val origin = mobileChatOrigin() ?: return
    val context = LocalContext.current
    val language = LocalConfiguration.current.locales[0].toLanguageTag()
    val address = origin.buildUpon().path("/mobile").appendQueryParameter("lang", language).build()
    val unavailable = stringResource(R.string.mobile_browser_unavailable)
    OutlinedButton(onClick = {
        try {
            CustomTabsIntent.Builder().build().launchUrl(context, address)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, unavailable, Toast.LENGTH_LONG).show()
        }
    }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.mobile_standalone_chat))
    }
}
