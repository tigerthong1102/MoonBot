// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.ClaudeUpdateResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val UPDATE_COMMAND = "claude update"
private const val UPDATE_CLIP_LABEL = "Claude Code update command"

sealed interface ClaudeUpdatePhase {
    data object Ask : ClaudeUpdatePhase
    data object Updating : ClaudeUpdatePhase
    data class Updated(val version: String) : ClaudeUpdatePhase
    data object Manual : ClaudeUpdatePhase
    data class Failed(val error: String) : ClaudeUpdatePhase
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ClaudeUpdateCard(messageId: String, instanceId: String) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    var phase by remember(messageId) { mutableStateOf<ClaudeUpdatePhase>(ClaudeUpdatePhase.Ask) }
    var copied by remember(messageId) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1_200)
            copied = false
        }
    }

    fun update() {
        if (phase == ClaudeUpdatePhase.Updating) return
        phase = ClaudeUpdatePhase.Updating
        scope.launch {
            phase = when (val result = session.updateClaude(instanceId)) {
                is ClaudeUpdateResult.Updated -> ClaudeUpdatePhase.Updated(result.version)
                is ClaudeUpdateResult.Failed -> ClaudeUpdatePhase.Failed(result.message)
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(secondaryTint.copy(alpha = 0.13f), RoundedCornerShape(22.dp))
            .padding(16.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        when (val current = phase) {
            ClaudeUpdatePhase.Ask -> {
                Text(
                    stringResource(R.string.ui_this_model_needs_a_newer_claude_code_i_can_update_claude_for_you),
                    fontSize = 15.sp,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Button(onClick = ::update) { Text(stringResource(R.string.ui_update_claude_for_me)) }
                    TextButton(onClick = { phase = ClaudeUpdatePhase.Manual }) {
                        Text(stringResource(R.string.ui_i_ll_do_it_myself))
                    }
                }
            }
            ClaudeUpdatePhase.Updating -> Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(
                    strokeWidth = 1.5.dp,
                    modifier = Modifier.size(14.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    stringResource(R.string.ui_updating_claude_code_this_can_take_a_minute),
                    fontSize = 15.sp,
                    color = secondaryTint,
                )
            }
            is ClaudeUpdatePhase.Updated -> Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val green = Color(MausPalette.argb("green"))
                Icon(Icons.Filled.Check, contentDescription = null, tint = green, modifier = Modifier.size(16.dp))
                Text(
                    stringResource(R.string.ui_claude_updated_send_your_message_again, current.version),
                    fontSize = 15.sp,
                )
            }
            ClaudeUpdatePhase.Manual, is ClaudeUpdatePhase.Failed -> {
                if (current is ClaudeUpdatePhase.Failed) {
                    SelectionContainer {
                        Text(current.error, fontSize = 15.sp, color = MaterialTheme.colorScheme.error)
                    }
                }
                Text(
                    stringResource(R.string.ui_run_this_in_terminal_on_your_computer_then_send_your_message_aga),
                    fontSize = 15.sp,
                    color = secondaryTint,
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(secondaryTint.copy(alpha = 0.08f), RoundedCornerShape(10.dp))
                        .padding(start = 12.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SelectionContainer(modifier = Modifier.weight(1f)) {
                        Text(UPDATE_COMMAND, fontSize = 14.sp, fontFamily = FontFamily.Monospace)
                    }
                    TextButton(
                        onClick = {
                            scope.launch {
                                clipboard.setClipEntry(
                                    ClipEntry(ClipData.newPlainText(UPDATE_CLIP_LABEL, UPDATE_COMMAND)),
                                )
                                copied = true
                            }
                        },
                    ) { Text(if (copied) stringResource(R.string.ui_copied) else stringResource(R.string.ui_copy), fontWeight = FontWeight.Medium) }
                }
                if (current is ClaudeUpdatePhase.Failed) {
                    Button(onClick = ::update) { Text(stringResource(R.string.ui_try_updating_again)) }
                }
            }
        }
    }
}
