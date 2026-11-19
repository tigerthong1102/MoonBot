// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.QuickReply
import com.openmausbot.companion.storage.ChatPreferences

@Composable
fun QuickRepliesEditor(
    preferences: ChatPreferences,
    onDismiss: () -> Unit,
) {
    val replies by preferences.quickReplies.collectAsState()
    var editing by remember { mutableStateOf<QuickReply?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.ui_quick_replies)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    if (replies.isEmpty()) {
                        stringResource(R.string.ui_the_chip_row_is_hidden_while_this_list_is_empty)
                    } else {
                        stringResource(R.string.ui_edit_reorder_or_remove_the_prompts_shown_above_an_empty_composer)
                    },
                    fontSize = 13.sp,
                    color = secondaryTint,
                )
                replies.forEachIndexed { index, reply ->
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(reply.title, fontWeight = FontWeight.Medium, maxLines = 1)
                                Text(
                                    reply.prompt,
                                    fontSize = 12.sp,
                                    color = secondaryTint,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            TextButton(onClick = { editing = reply }) { Text(stringResource(R.string.ui_edit)) }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            TextButton(
                                enabled = index > 0,
                                onClick = { preferences.setQuickReplies(replies.move(index, index - 1)) },
                            ) { Text(stringResource(R.string.ui_move_up)) }
                            TextButton(
                                enabled = index < replies.lastIndex,
                                onClick = { preferences.setQuickReplies(replies.move(index, index + 1)) },
                            ) { Text(stringResource(R.string.ui_move_down)) }
                            TextButton(
                                onClick = { preferences.setQuickReplies(replies.filterNot { it.id == reply.id }) },
                            ) { Text(stringResource(R.string.ui_remove_165)) }
                        }
                        HorizontalDivider()
                    }
                }
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = { adding = true }) { Text(stringResource(R.string.ui_add)) }
                TextButton(
                    onClick = { confirmReset = true },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) { Text(stringResource(R.string.ui_reset)) }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.ui_done)) }
            }
        },
        dismissButton = {},
    )

    editing?.let { reply ->
        QuickReplyForm(
            initial = reply,
            onDismiss = { editing = null },
            onSave = { updated ->
                preferences.setQuickReplies(replies.map { if (it.id == updated.id) updated else it })
                editing = null
            },
        )
    }
    if (adding) {
        QuickReplyForm(
            initial = remember { QuickReply(title = "", prompt = "", icon = QuickReply.ICON_CHOICES.first()) },
            onDismiss = { adding = false },
            onSave = { created ->
                preferences.setQuickReplies(replies + created)
                adding = false
            },
        )
    }
    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text(stringResource(R.string.ui_reset_quick_replies)) },
            text = { Text(stringResource(R.string.ui_this_restores_the_four_chips_the_app_came_with_and_discards_your)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        preferences.resetQuickReplies()
                        confirmReset = false
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) { Text(stringResource(R.string.ui_reset)) }
            },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text(stringResource(R.string.ui_cancel)) } },
        )
    }
}

@Composable
private fun QuickReplyForm(
    initial: QuickReply,
    onDismiss: () -> Unit,
    onSave: (QuickReply) -> Unit,
) {
    var title by remember(initial.id) { mutableStateOf(initial.title) }
    var prompt by remember(initial.id) { mutableStateOf(initial.prompt) }
    var icon by remember(initial.id) { mutableStateOf(initial.icon) }
    val haptics = rememberHaptics()
    val cleanTitle = title.trim()
    val cleanPrompt = prompt.trim()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial.title.isBlank()) stringResource(R.string.ui_new_quick_reply) else stringResource(R.string.ui_edit_quick_reply)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text(stringResource(R.string.ui_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text(stringResource(R.string.ui_prompt)) },
                    minLines = 2,
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(stringResource(R.string.ui_icon), fontSize = 13.sp, color = secondaryTint)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    QuickReply.ICON_CHOICES.forEach { choice ->
                        FilterChip(
                            selected = choice == icon,
                            onClick = {
                                icon = choice
                                haptics.play(TactileAction.CHOOSE_QUICK_REPLY_ICON)
                            },
                            label = { Text(quickReplyGlyph(choice), fontSize = 13.sp) },
                            modifier = Modifier.semantics { contentDescription = choice },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = cleanTitle.isNotEmpty() && cleanPrompt.isNotEmpty(),
                onClick = { onSave(initial.copy(title = cleanTitle, prompt = cleanPrompt, icon = icon)) },
            ) { Text(stringResource(R.string.ui_save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.ui_cancel)) } },
    )
}

private fun <T> List<T>.move(from: Int, to: Int): List<T> {
    if (from !in indices || to !in indices || from == to) return this
    return toMutableList().also { items -> items.add(to, items.removeAt(from)) }
}
