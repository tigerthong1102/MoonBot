// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R


@Composable
fun CommandSkillHud(
    commands: List<SlashCommand>,
    draft: String,
    onSelect: (SlashCommand) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val resources = LocalResources.current
    val visible = SlashCommands.matching(commands, draft, resources::getString)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .chromeSheet(cornerRadius = HUD_RADIUS)
            .clip(RoundedCornerShape(HUD_RADIUS))
            .padding(bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 14.dp, top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.ui_slash_commands),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = secondaryTint,
                modifier = Modifier.weight(1f),
            )
            TouchTarget(onClick = onClose, contentDescription = stringResource(R.string.ui_close_slash_commands)) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = null,
                    tint = secondaryTint,
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            visible.forEach { command ->
                CommandCard(command = command, onSelect = { onSelect(command) })
            }
        }
    }
}

@Composable
private fun CommandCard(command: SlashCommand, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .width(COMMAND_CARD_WIDTH)
            .heightIn(min = COMMAND_CARD_HEIGHT)
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .clickable(role = Role.Button, onClick = onSelect),
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(accent(command.id)),
        )
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = command.title,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = stringResource(command.description),
                fontSize = 11.sp,
                color = secondaryTint,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun PredictiveChipsRow(
    chips: List<PredictiveChip>,
    onSelect: (PredictiveChip) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        chips.forEach { chip ->
            AssistChip(
                onClick = { onSelect(chip) },
                label = { Text(chip.title, fontSize = 13.sp) },
                leadingIcon = chip.icon?.let { icon ->
                    { Text(quickReplyGlyph(icon), fontSize = 13.sp) }
                },
                border = AssistChipDefaults.assistChipBorder(enabled = true),
            )
        }
        Spacer(Modifier.width(4.dp))
    }
}

internal fun quickReplyGlyph(icon: String): String = when (icon) {
    "next" -> "→"
    "diff" -> "±"
    "tests" -> "✓"
    "explain" -> "?"
    "build" -> "⌁"
    "bug" -> "!"
    "document" -> "▤"
    "terminal" -> ">_"
    "send" -> "↑"
    "search" -> "⌕"
    "history" -> "↶"
    "list" -> "☷"
    else -> "•"
}

private val HUD_RADIUS = 16.dp
private val COMMAND_CARD_WIDTH = 168.dp
private val COMMAND_CARD_HEIGHT = 62.dp

private fun accent(id: SlashCommandId): Color = when (id) {
    SlashCommandId.COMPUTER -> Color(0xFF38BDF8)
    SlashCommandId.TASKS -> Color(0xFFA855F7)
    SlashCommandId.DIFF -> Color(0xFF22C55E)
    SlashCommandId.RETRY -> Color(0xFFEAB308)
    SlashCommandId.STEER -> Color(0xFFF97316)
}
