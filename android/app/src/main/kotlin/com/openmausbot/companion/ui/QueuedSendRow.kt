// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.QueuedSend

@Composable
fun QueuedSendRow(
    send: QueuedSend,
    onSteer: (() -> Unit)?,
    steering: Boolean,
    onEdit: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
            .padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = send.text,
            fontSize = 15.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (onSteer != null) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f))
                    .clickable(enabled = !steering, role = Role.Button, onClick = onSteer)
                    .padding(horizontal = 11.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (steering) {
                    CircularProgressIndicator(
                        strokeWidth = 1.5.dp,
                        modifier = Modifier.size(12.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = null,
                        modifier = Modifier.size(13.dp),
                    )
                }
                Text(
                    text = if (steering) "Steering…" else "Steer",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        Icon(
            imageVector = Icons.Filled.Edit,
            contentDescription = "Edit this queued message",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .clickable(role = Role.Button, onClick = onEdit)
                .padding(6.dp)
                .size(16.dp),
        )
        Icon(
            imageVector = Icons.Filled.Delete,
            contentDescription = "Delete this queued message",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .clickable(role = Role.Button, onClick = onCancel)
                .padding(6.dp)
                .size(16.dp),
        )
    }
}

object ComposerPromise {
    fun placeholder(
        name: String,
        busy: Boolean,
        engineCanSteer: Boolean,
        sending: Boolean,
        listening: Boolean,
    ): String = when {
        sending -> "Sending…"
        listening -> "Listening…"
        !busy -> "Ask $name"
        engineCanSteer -> "Sends into this turn"
        else -> "Sends after this turn"
    }
}
