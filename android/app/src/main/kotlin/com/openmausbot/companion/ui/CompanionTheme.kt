// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDirection

private val Green = Color(MausPalette.argb("green"))

private val LightColors = lightColorScheme(
    primary = Green,
    onPrimary = Color.White,
    secondary = Green,
)

private val DarkColors = darkColorScheme(
    primary = Green,
    onPrimary = Color.White,
    secondary = Green,
)

private fun TextStyle.readingFromContent(): TextStyle =
    copy(textDirection = TextDirection.ContentOrLtr)

private val ContentDirectedTypography: Typography = Typography().run {
    copy(
        displayLarge = displayLarge.readingFromContent(),
        displayMedium = displayMedium.readingFromContent(),
        displaySmall = displaySmall.readingFromContent(),
        headlineLarge = headlineLarge.readingFromContent(),
        headlineMedium = headlineMedium.readingFromContent(),
        headlineSmall = headlineSmall.readingFromContent(),
        titleLarge = titleLarge.readingFromContent(),
        titleMedium = titleMedium.readingFromContent(),
        titleSmall = titleSmall.readingFromContent(),
        bodyLarge = bodyLarge.readingFromContent(),
        bodyMedium = bodyMedium.readingFromContent(),
        bodySmall = bodySmall.readingFromContent(),
        labelLarge = labelLarge.readingFromContent(),
        labelMedium = labelMedium.readingFromContent(),
        labelSmall = labelSmall.readingFromContent(),
    )
}

@Composable
fun CompanionTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = ContentDirectedTypography,
        content = content,
    )
}

val secondaryTint: Color
    @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant
