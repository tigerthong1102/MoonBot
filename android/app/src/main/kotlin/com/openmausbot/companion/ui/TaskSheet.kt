// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.BotThreadGroup
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatTarget
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.forTask
import com.openmausbot.companion.core.isArchived
import com.openmausbot.companion.core.isSnoozed
import com.openmausbot.companion.core.target
import com.openmausbot.companion.core.threadGroups
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskSheet(
    chat: Chat,
    onDismiss: () -> Unit,
    onSelectTask: (ChatTarget) -> Unit,
    onDeletedCurrent: () -> Unit = {},
    nowMillis: () -> Long = System::currentTimeMillis,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val state by session.state.collectAsState()

    val current = remember(state, chat) {
        when (chat) {
            is Chat.BotChat -> state.bots.firstOrNull { it.id == chat.id }?.let {
                Chat.BotChat(it.forTask(chat.threadId) ?: it)
            }
            is Chat.RoomChat -> state.rooms.firstOrNull { it.id == chat.id }?.let(Chat::RoomChat)
        }
    }
    if (current == null) {
        LaunchedEffect(chat.id) { onDismiss() }
        return
    }

    var renaming by remember { mutableStateOf<BotTask?>(null) }
    var title by remember { mutableStateOf("") }
    var pendingDelete by remember { mutableStateOf<BotTask?>(null) }
    var pendingSnooze by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun failed() {
        error = session.actionError ?: "Couldn't update this thread. Try again."
        session.actionError = null
    }

    val (groups, archived) = when (current) {
        is Chat.BotChat -> {
            val all = current.bot.threadGroups(
                includingClosed = true,
                queuedThreadIds = state.queuedThreadIds,
            )
            val folded = all.flatMap { it.tasks }.filter {
                it.pinned != true &&
                    it.isArchived &&
                    !TaskRules.demandsAttention(it, queued = it.threadId in state.queuedThreadIds) &&
                    !TaskRules.isCurrent(it, current)
            }
            val foldedIds = folded.map { it.threadId }.toSet()
            all.mapNotNull { group ->
                group.copy(tasks = group.tasks.filter { it.threadId !in foldedIds })
                    .takeIf { it.tasks.isNotEmpty() }
            } to folded
        }
        is Chat.RoomChat -> listOf(BotThreadGroup(null, TaskRules.tasks(current))) to emptyList()
    }

    val pinHandler: (BotTask) -> Unit = { task ->
        saving = true
        error = null
        scope.launch {
            val ok = pinTask(session, task, current, task.pinned != true)
            saving = false
            if (!ok) failed()
        }
    }

    val archiveHandler: (BotTask) -> Unit = { task ->
        saving = true
        error = null
        scope.launch {
            val stamped = if (task.isArchived) null else System.currentTimeMillis().toDouble()
            val ok = archiveTask(session, task, current, stamped)
            saving = false
            if (!ok) failed()
        }
    }

    val now = rememberSnoozeNow(groups.flatMap { it.tasks })

    BasicAlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = true),
    ) {
        Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(vertical = 16.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.ui_s_threads, current.name),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        imageVector = Icons.Filled.Add,
                        contentDescription = stringResource(R.string.ui_new_thread),
                        tint = if (TaskRules.canCreate(current)) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            secondaryTint.copy(alpha = 0.4f)
                        },
                        modifier = Modifier
                            .size(48.dp)
                            .clickable(enabled = !saving && TaskRules.canCreate(current)) {
                                saving = true
                                error = null
                                scope.launch {
                                    val created = createTask(session, current, null)
                                    saving = false
                                    if (created == null) failed() else {
                                        onSelectTask(created.target)
                                        onDismiss()
                                    }
                                }
                            }
                            .padding(12.dp),
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ChatAvatar(chat = current, size = 48.dp, state = MausState.IDLE, animated = false)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(current.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Text(TaskRules.subtitle(current), fontSize = 14.sp, color = secondaryTint)
                    }
                }
                Text(
                    text = TaskRules.CONTEXT_FOOTER,
                    fontSize = 13.sp,
                    color = secondaryTint,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                )
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                }

                LazyColumn(modifier = Modifier.heightIn(max = 360.dp)) {
                    groups.forEach { group ->
                        group.project?.let { project ->
                            item(key = group.id) {
                                Text(
                                    "${project.emoji ?: "📁"} ${project.name}", color = secondaryTint,
                                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                                )
                            }
                        }
                        items(group.tasks, key = { it.threadId }) { task ->
                            TaskRow(
                                task = task,
                                chat = current,
                                enabled = !saving,
                                now = now,
                                queued = task.threadId in state.queuedThreadIds,
                                onSwitch = {
                                    saving = true
                                    error = null
                                    scope.launch {
                                        val selected = switchTask(session, task, current)
                                        saving = false
                                        if (selected == null) failed() else {
                                            onSelectTask(selected.target)
                                            onDismiss()
                                        }
                                    }
                                },
                                onRename = {
                                    title = task.title
                                    error = null
                                    renaming = task
                                },
                                onSnooze = if (current is Chat.BotChat) {
                                    { error = null; pendingSnooze = task.threadId }
                                } else {
                                    null
                                },
                                onDelete = { error = null; pendingDelete = task },
                                onArchive = (current as? Chat.BotChat)?.let { archiveHandler },
                                onPin = pinHandler,
                            )
                        }
                    }
                    if (archived.isNotEmpty()) {
                        item(key = "archived") {
                            Text(
                                stringResource(R.string.ui_archived),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = secondaryTint,
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                            )
                        }
                        items(archived, key = { it.threadId }) { task ->
                            TaskRow(
                                task = task,
                                chat = current,
                                enabled = !saving,
                                now = now,
                                queued = task.threadId in state.queuedThreadIds,
                                onSwitch = {
                                    saving = true
                                    error = null
                                    scope.launch {
                                        val selected = switchTask(session, task, current)
                                        saving = false
                                        if (selected == null) failed() else {
                                            onSelectTask(selected.target)
                                            onDismiss()
                                        }
                                    }
                                },
                                onRename = {
                                    title = task.title
                                    error = null
                                    renaming = task
                                },
                                onSnooze = null,
                                onDelete = { error = null; pendingDelete = task },
                                onArchive = (current as? Chat.BotChat)?.let { archiveHandler },
                                onPin = pinHandler,
                            )
                        }
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = onDismiss, enabled = !saving) { Text(stringResource(R.string.ui_done)) }
                }
            }
        }
    }

    renaming?.let { task ->
        TaskTitleDialog(
            heading = "Rename thread",
            label = stringResource(R.string.ui_title),
            title = title,
            onTitleChange = { title = it },
            confirmText = "Save",
            confirmEnabled = !saving && TaskDialogRules.renameEnabled(current, title),
            error = error,
            onConfirm = {
                val requested = TaskDialogRules.renameTitle(title)
                saving = true
                error = null
                scope.launch {
                    val renamed = renameTask(session, task, current, requested)
                    saving = false
                    if (renamed) renaming = null else failed()
                }
            },
            onCancel = { if (!saving) { renaming = null; error = null } },
        )
    }
    pendingDelete?.let { task ->
        AlertDialog(
            onDismissRequest = { if (!saving) pendingDelete = null },
            title = { Text(stringResource(R.string.ui_delete, TaskRules.title(task))) },
            text = { Text(error ?: stringResource(R.string.ui_this_conversation_will_be_deleted_generated_files_are_kept)) },
            confirmButton = {
                TextButton(enabled = !saving && TaskRules.canDelete(task, current), onClick = {
                    if (!TaskRules.canDelete(task, current)) return@TextButton
                    saving = true
                    error = null
                    scope.launch {
                        val updated = deleteTask(session, task, current)
                        saving = false
                        if (updated == null) failed() else {
                            pendingDelete = null
                            if (task.threadId == chat.threadId) {
                                onDismiss()
                                if (chat is Chat.BotChat) onDeletedCurrent() else onSelectTask(updated.target)
                            }
                        }
                    }
                }) { Text(stringResource(R.string.ui_delete_9), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { pendingDelete = null; error = null }) { Text(stringResource(R.string.ui_cancel)) } },
        )
    }

    pendingSnooze?.let { threadId ->
        val task = snoozeTarget((current as? Chat.BotChat)?.bot, threadId) ?: return@let
        val working = TaskRules.isWorking(task)
        AlertDialog(
            onDismissRequest = { if (!saving) pendingSnooze = null },
            title = { Text(stringResource(R.string.ui_snooze, TaskRules.title(task))) },
            text = {
                Column {
                    error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error)
                    }
                    if (working) {
                        Text(stringResource(R.string.ui_stop_this_thread_before_snoozing_it), color = secondaryTint)
                    } else {
                        SnoozeRules.presets.forEach { preset ->
                            TextButton(
                                enabled = !saving,
                                onClick = {
                                    val bot = (current as? Chat.BotChat)?.bot ?: return@TextButton
                                    val live = snoozeTarget(bot, threadId) ?: return@TextButton
                                    if (TaskRules.isWorking(live)) return@TextButton
                                    saving = true
                                    error = null
                                    val until = preset.until(nowMillis())
                                    scope.launch {
                                        val snoozed = session.snoozeTask(live, bot, until)
                                        saving = false
                                        if (snoozed) pendingSnooze = null else failed()
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(preset.label) }
                        }
                        if (task.isSnoozed(now)) {
                            TextButton(
                                enabled = !saving,
                                onClick = {
                                    val bot = (current as? Chat.BotChat)?.bot ?: return@TextButton
                                    val live = snoozeTarget(bot, threadId) ?: return@TextButton
                                    if (TaskRules.isWorking(live)) return@TextButton
                                    saving = true
                                    error = null
                                    scope.launch {
                                        val woken = session.snoozeTask(live, bot, null)
                                        saving = false
                                        if (woken) pendingSnooze = null else failed()
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(SnoozeRules.STOP_SNOOZING) }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(enabled = !saving, onClick = { pendingSnooze = null; error = null }) {
                    Text(stringResource(R.string.ui_cancel))
                }
            },
        )
    }
}

internal fun snoozeTarget(bot: Bot?, threadId: String): BotTask? =
    bot?.tasks.orEmpty().firstOrNull { it.threadId == threadId && it.routineRunId == null }

@Composable
private fun TaskRow(
    task: BotTask,
    chat: Chat,
    enabled: Boolean,
    now: Long,
    queued: Boolean,
    onSwitch: () -> Unit,
    onRename: () -> Unit,
    onSnooze: (() -> Unit)?,
    onDelete: () -> Unit,
    onArchive: ((BotTask) -> Unit)? = null,
    onPin: (BotTask) -> Unit,
) {
    val current = TaskRules.isCurrent(task, chat)
    val canSwitch = enabled && TaskRules.canSwitch(task, chat)
    val canDelete = enabled && TaskRules.canDelete(task, chat)
    val canArchive = enabled && TaskRules.canArchive(task, chat)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = canSwitch, onClick = onSwitch)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BotThreadRow(task, selected = current, modifier = Modifier.weight(1f), now = now, queued = queued)

        val pinLabel = if (task.pinned == true) "Unpin" else "Pin"
        Text(
            text = pinLabel,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = if (enabled) secondaryTint else secondaryTint.copy(alpha = 0.4f),
            modifier = Modifier
                .clickable(enabled = enabled) { onPin(task) }
                .semantics { contentDescription = "$pinLabel ${TaskRules.title(task)}" }
                .padding(horizontal = 8.dp),
        )

        if (onArchive != null) {
            val label = if (task.isArchived) "Unarchive" else "Archive"
            Text(
                text = label,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = if (canArchive) secondaryTint else secondaryTint.copy(alpha = 0.4f),
                modifier = Modifier
                    .clickable(enabled = canArchive) { onArchive(task) }
                    .semantics { contentDescription = "$label ${TaskRules.title(task)}" }
                    .padding(horizontal = 8.dp),
            )
        }

        Icon(
            imageVector = Icons.Filled.Edit,
            contentDescription = stringResource(R.string.ui_rename, TaskRules.title(task)),
            tint = secondaryTint,
            modifier = Modifier
                .size(48.dp)
                .clickable(enabled = enabled && TaskRules.canRename(chat), onClick = onRename)
                .padding(14.dp),
        )

        if (onSnooze != null) {
            Icon(
                imageVector = Icons.Filled.Notifications,
                contentDescription = stringResource(R.string.ui_snooze, TaskRules.title(task)),
                tint = if (enabled && !TaskRules.isWorking(task)) secondaryTint
                else secondaryTint.copy(alpha = 0.4f),
                modifier = Modifier
                    .size(48.dp)
                    .clickable(enabled = enabled && !TaskRules.isWorking(task), onClick = onSnooze)
                    .padding(14.dp),
            )
        }

        Icon(
            imageVector = Icons.Filled.Delete,
            contentDescription = stringResource(R.string.ui_delete_14, TaskRules.title(task)),
            tint = if (canDelete) MaterialTheme.colorScheme.error else secondaryTint.copy(alpha = 0.4f),
            modifier = Modifier
                .size(48.dp)
                .clickable(enabled = canDelete, onClick = onDelete)
                .padding(14.dp),
        )
    }
}

private suspend fun createTask(session: Session, chat: Chat, title: String?): Chat? =
    when (chat) {
        is Chat.BotChat -> session.createTask(chat.bot, title)?.let(Chat::BotChat)
        is Chat.RoomChat -> session.createTask(chat.room, title)?.let(Chat::RoomChat)
    }

private suspend fun switchTask(session: Session, task: BotTask, chat: Chat): Chat? =
    when (chat) {
        is Chat.BotChat -> session.state.value.bots.firstOrNull { it.id == chat.id }
            ?.forTask(task.threadId)?.let(Chat::BotChat)
        is Chat.RoomChat -> session.switchTask(task, chat.room)?.let(Chat::RoomChat)
    }

private suspend fun renameTask(
    session: Session,
    task: BotTask,
    chat: Chat,
    title: String,
): Boolean =
    when (chat) {
        is Chat.BotChat -> session.renameTask(task, chat.bot, title)
        is Chat.RoomChat -> session.renameTask(task, chat.room, title)
    }

private suspend fun deleteTask(session: Session, task: BotTask, chat: Chat): Chat? =
    when (chat) {
        is Chat.BotChat -> session.deleteTask(task, chat.bot)?.let(Chat::BotChat)
        is Chat.RoomChat -> session.deleteTask(task, chat.room)?.let(Chat::RoomChat)
    }

private suspend fun pinTask(session: Session, task: BotTask, chat: Chat, pinned: Boolean): Boolean =
    session.pinTask(task, chat, pinned)

private suspend fun archiveTask(session: Session, task: BotTask, chat: Chat, archivedAt: Double?): Boolean =
    when (chat) {
        is Chat.BotChat -> session.archiveTask(task, chat.bot, archivedAt)
        is Chat.RoomChat -> false
    }

@Composable
private fun TaskTitleDialog(
    heading: String,
    label: String,
    title: String,
    onTitleChange: (String) -> Unit,
    confirmText: String,
    confirmEnabled: Boolean,
    error: String? = null,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(heading) },
        text = {
            Column {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                OutlinedTextField(
                value = title,
                onValueChange = onTitleChange,
                label = { Text(label) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = confirmEnabled) { Text(confirmText) }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.ui_cancel)) } },
    )
}
