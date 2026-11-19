// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.R

// Android RenderEffect requires API 31 or later.

internal val MIN_TOUCH_TARGET: Dp = 48.dp

private val CHROME_ELEVATION: Dp = 3.dp

@Composable
internal fun Modifier.chromeCapsule(elevation: Dp = CHROME_ELEVATION): Modifier =
    chrome(CircleShape, elevation)

@Composable
internal fun Modifier.chromeSheet(cornerRadius: Dp = 28.dp, elevation: Dp = 6.dp): Modifier =
    chrome(RoundedCornerShape(cornerRadius), elevation)

@Composable
internal fun Modifier.chrome(shape: Shape, elevation: Dp = CHROME_ELEVATION): Modifier = this
    .shadow(elevation, shape, clip = false)
    .background(MaterialTheme.colorScheme.surfaceContainerHigh, shape)

@Composable
internal fun ChromeButton(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    glyph: Dp = 20.dp,
    enabled: Boolean = true,
    tint: Color = Color.Unspecified,
) {
    ChromeButton(modifier, size, enabled, onClick) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint,
            modifier = Modifier.size(glyph),
        )
    }
}

@Composable
internal fun ChromeButton(
    painter: Painter,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    glyph: Dp = 20.dp,
    enabled: Boolean = true,
    tint: Color = Color.Unspecified,
) {
    ChromeButton(modifier, size, enabled, onClick) {
        Icon(
            painter = painter,
            contentDescription = contentDescription,
            tint = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint,
            modifier = Modifier.size(glyph),
        )
    }
}

@Composable
private fun ChromeButton(
    modifier: Modifier,
    size: Dp,
    enabled: Boolean,
    onClick: () -> Unit,
    glyph: @Composable () -> Unit,
) {
    TouchTarget(modifier = modifier, size = size, enabled = enabled, onClick = onClick) {
        Box(
            modifier = Modifier
                .size(size)
                .chromeCapsule(),
            contentAlignment = Alignment.Center,
            content = { glyph() },
        )
    }
}

@Composable
internal fun HeaderBackButton(onBack: () -> Unit, modifier: Modifier = Modifier) {
    TouchTarget(onClick = onBack, modifier = modifier, contentDescription = stringResource(R.string.ui_back)) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = null,
            modifier = Modifier
                .size(32.dp)
                .background(secondaryTint.copy(alpha = 0.16f), CircleShape)
                .padding(6.dp),
        )
    }
}

@Composable
internal fun TouchTarget(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = MIN_TOUCH_TARGET,
    enabled: Boolean = true,
    contentDescription: String? = null,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .size(if (size > MIN_TOUCH_TARGET) size else MIN_TOUCH_TARGET)
            .clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .then(
                if (contentDescription == null) {
                    Modifier
                } else {
                    Modifier.semantics { this.contentDescription = contentDescription }
                },
            ),
        contentAlignment = Alignment.Center,
        content = content,
    )
}
