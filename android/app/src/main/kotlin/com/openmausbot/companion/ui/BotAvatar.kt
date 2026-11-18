// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.avatar.AvatarImageRules
import com.openmausbot.companion.core.AvatarCrop
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Chat

// Avatar attachment requests are authenticated to the paired computer.
@Composable
internal fun BotAvatar(
    bot: Bot,
    size: Dp,
    state: MausState = MausState.IDLE,
    animated: Boolean = true,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
) {
    val crop = bot.avatarCrop ?: AvatarCrop.MASCOT
    val path = bot.avatarUrl
    val store = LocalCompanion.current.avatars

    val identity = remember(path, crop) { BotAvatarRules.identity(path, crop) }
    var image by remember(identity) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(identity) { mutableStateOf(false) }

    LaunchedEffect(identity) {
        if (crop == AvatarCrop.MASCOT || path == null) return@LaunchedEffect
        val decoded = store.bitmapFor(bot)
        if (decoded == null) {
            failed = true
            return@LaunchedEffect
        }
        image = decoded
    }

    val named = if (contentDescription == null) {
        modifier
    } else {
        modifier.semantics { this.contentDescription = contentDescription }
    }

    val painted = image
    if (painted != null && AvatarImageRules.usesImage(crop, path, failed)) {
        val bitmap = remember(painted) { painted.asImageBitmap() }
        Image(
            bitmap = bitmap,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = named.size(size).clip(BotAvatarRules.shape(crop, size)),
        )
    } else {
        MausAvatar(
            color = bot.color,
            bodyId = bot.mascotBody,
            size = size,
            state = state,
            animated = animated,
            modifier = named,
        )
    }
}

@Composable
internal fun ChatAvatar(
    chat: Chat,
    size: Dp,
    state: MausState = MausState.IDLE,
    animated: Boolean = true,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
) {
    when (chat) {
        is Chat.BotChat -> BotAvatar(
            bot = chat.bot,
            size = size,
            state = state,
            animated = animated,
            contentDescription = contentDescription,
            modifier = modifier,
        )
        is Chat.RoomChat -> MausAvatar(
            color = "blue",
            size = size,
            state = state,
            animated = animated,
            modifier = modifier,
        )
    }
}

internal object BotAvatarRules {
    fun identity(avatarUrl: String?, crop: AvatarCrop): String =
        "${avatarUrl.orEmpty()}|${crop.name.lowercase()}"

    fun shape(crop: AvatarCrop, size: Dp): Shape = when (crop) {
        AvatarCrop.CIRCLE -> CircleShape
        AvatarCrop.ROUNDED -> RoundedCornerShape(
            AvatarImageRules.roundedCornerRadius(size.value).dp,
        )
        AvatarCrop.SQUARE, AvatarCrop.MASCOT -> RectangleShape
    }
}
