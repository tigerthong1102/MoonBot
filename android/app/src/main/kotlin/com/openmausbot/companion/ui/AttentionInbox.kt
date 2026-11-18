// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.displayTitle

@Immutable
internal data class AttentionEntry(
    val botId: String,
    val botName: String,
    val task: BotTask,
    val queued: Boolean,
) {
    val id: String get() = "$botId-${task.threadId}"

    fun statusLine(): String = when {
        task.activity == "waiting-on-you" -> "Waiting on you"
        task.busy == true || task.activity == "working" -> "Working"
        queued -> "Queued"
        else -> "Unread"
    }
}

internal fun CompanionState.crossBotAttention(exceptBotId: String? = null): List<AttentionEntry> {
    val entries = bots
        .filter { it.id != exceptBotId && it.hidden != true }
        .flatMap { bot ->
            attentionTasks(bot)
                .map { it to (pendingQueued[it.threadId].orEmpty().isNotEmpty()) }
                .filter { (task, queued) ->
                    task.activity == "waiting-on-you" || task.activity == "working" ||
                        task.busy == true || queued || task.unread == true
                }
                .map { (task, queued) -> AttentionEntry(bot.id, bot.name, task, queued) }
        }
    return entries.sortedBy(::attentionRank)
}

private fun attentionTasks(bot: Bot): List<BotTask> {
    val tasks = bot.tasks ?: listOf(
        BotTask(
            threadId = bot.threadId, title = "", createdAt = bot.createdAt,
            busy = bot.busy, activity = bot.activity, unread = bot.unread,
        ),
    )
    return tasks.filter { it.routineRunId == null }
}

private fun attentionRank(entry: AttentionEntry): Int = when {
    entry.task.activity == "waiting-on-you" -> 0
    entry.task.busy == true || entry.task.activity == "working" -> 1
    entry.queued -> 2
    else -> 3
}

@Composable
internal fun AttentionRow(entry: AttentionEntry, onOpen: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.task.displayTitle,
                fontSize = 15.sp,
                fontWeight = if (entry.task.unread == true) FontWeight.SemiBold else FontWeight.Medium,
                color = if (entry.task.activity == "waiting-on-you") {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${entry.botName} · ${entry.statusLine()}",
                fontSize = 12.sp,
                color = secondaryTint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
