// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.content.ClipData
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.AttachedMessageContent
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.DisplayedMessageAttachment
import com.openmausbot.companion.core.DownloadedFile
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.ThreadRef
import com.openmausbot.companion.core.ToolActivity
import com.openmausbot.companion.core.TranscriptCard
import com.openmausbot.companion.core.TranscriptCards
import com.openmausbot.companion.core.forTask
import com.openmausbot.companion.core.generatedImages
import com.openmausbot.companion.core.voiceNotes
import com.openmausbot.companion.core.webhookContent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MESSAGE_CLIP_LABEL = "StartupBot message"

@Composable
fun MessageRow(
    chat: Chat,
    message: Message,
    endsRun: Boolean = true,
    openLink: ((String, Message) -> Unit)? = null,
    /** Open one exact user attachment through the authenticated computer route. */
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)? = null,
    openThread: ((ThreadRef) -> Unit)? = null,
) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val state by session.state.collectAsState()
    val clipboard = LocalClipboard.current
    var menuOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var editText by remember { mutableStateOf("") }
    var selectingText by remember { mutableStateOf<String?>(null) }

    val bot = (chat as? Chat.BotChat)?.bot
    val versions = remember(state, message.id) { state.versions(message, chat.threadId) }
    val versionIndex = versions.indexOfFirst { it.id == message.id }
    val editPending = state.pendingEdits[chat.threadId]
    val isPendingEdit = editPending?.placeholderId == message.id
    val mine = message.role == Message.Role.USER

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onLongClick = { menuOpen = true },
                onClick = {},
            ),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            MessageContent(
                chat = chat,
                message = message,
                endsRun = endsRun,
                haptics = haptics,
                openLink = openLink,
                openAttachment = openAttachment,
                openThread = openThread,
            )

            message.comm?.let {
                Text(
                    text = stringResource(R.string.ui_messaged, it.withName),
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }

            message.reactions?.takeIf { it.isNotEmpty() }?.let { reactions ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Reactions.group(reactions).forEach { group ->
                        val tint = if (group.mine) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            secondaryTint
                        }
                        Text(
                            text = "${group.emoji} ${group.count}",
                            fontSize = 13.sp,
                            color = tint,
                            modifier = Modifier
                                .border(1.dp, tint.copy(alpha = 0.5f), CircleShape)
                                .clickable {
                                    haptics.play(TactileAction.TOGGLE_REACTION)
                                    scope.launch {
                                        session.react(message, chat.threadId, group.emoji)
                                    }
                                }
                                .padding(horizontal = 10.dp, vertical = 3.dp),
                        )
                    }
                }
            }

            if (versions.size > 1 && versionIndex >= 0 && bot != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val busy = bot.busy == true
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                        contentDescription = stringResource(R.string.ui_previous_version),
                        tint = if (versionIndex == 0 || busy) {
                            secondaryTint.copy(alpha = 0.4f)
                        } else {
                            secondaryTint
                        },
                        modifier = Modifier
                            .size(20.dp)
                            .clickable(enabled = versionIndex > 0 && !busy) {
                                scope.launch {
                                    session.switchVersion(versions[versionIndex - 1], bot)
                                }
                            },
                    )
                    Text(
                        text = stringResource(R.string.ui_of, versionIndex + 1, versions.size),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = secondaryTint,
                    )
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = stringResource(R.string.ui_next_version),
                        tint = if (versionIndex + 1 >= versions.size || busy) {
                            secondaryTint.copy(alpha = 0.4f)
                        } else {
                            secondaryTint
                        },
                        modifier = Modifier
                            .size(20.dp)
                            .clickable(enabled = versionIndex + 1 < versions.size && !busy) {
                                scope.launch {
                                    session.switchVersion(versions[versionIndex + 1], bot)
                                }
                            },
                    )
                }
            }
        }

        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            if (!isPendingEdit) Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                Reactions.CHOICES.forEach { emoji ->
                    Text(
                        text = emoji,
                        fontSize = 22.sp,
                        modifier = Modifier
                            .clickable {
                                menuOpen = false
                                haptics.play(TactileAction.TOGGLE_REACTION)
                                scope.launch { session.react(message, chat.threadId, emoji) }
                            }
                            .padding(8.dp),
                    )
                }
            }
            MessageActions.copyableText(message)?.let { text ->
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.ui_copy)) },
                    onClick = {
                        menuOpen = false
                        scope.launch {
                            clipboard.setClipEntry(
                                ClipEntry(ClipData.newPlainText(MESSAGE_CLIP_LABEL, text)),
                            )
                        }
                    },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.ui_select_text)) },
                    onClick = {
                        menuOpen = false
                        selectingText = text
                    },
                )
            }
            val editableText = MessageActions.editableText(message)
            if (editableText != null && bot != null && !isPendingEdit) {
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.ui_edit_and_retry)) },
                    enabled = bot.busy != true && editPending == null,
                    onClick = {
                        menuOpen = false
                        editText = editableText
                        editing = true
                    },
                )
            }
        }
    }

    if (editing && bot != null) {
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text(stringResource(R.string.ui_edit_and_retry)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.ui_this_creates_a_new_version_and_continues_from_there), fontSize = 14.sp)
                    OutlinedTextField(
                        value = editText,
                        onValueChange = { editText = it },
                        label = { Text(stringResource(R.string.ui_message)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = bot.busy != true && editText.isNotBlank(),
                    onClick = {
                        val text = editText.trim()
                        editing = false
                        if (text.isEmpty()) return@TextButton
                        scope.launch { session.edit(message, bot, text) }
                    },
                ) { Text(stringResource(R.string.ui_send)) }
            },
            dismissButton = {
                TextButton(onClick = { editing = false }) { Text(stringResource(R.string.ui_cancel)) }
            },
        )
    }

    selectingText?.let { text ->
        SelectableTextDialog(text = text, onDismiss = { selectingText = null })
    }
}

@Composable
private fun SelectableTextDialog(text: String, onDismiss: () -> Unit) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember(text) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.ui_select_text)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SelectionContainer {
                    Text(
                        text = text,
                        fontSize = 16.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 360.dp)
                            .verticalScroll(rememberScrollState()),
                    )
                }
                Text(
                    stringResource(R.string.ui_touch_and_hold_the_text_to_select_part_of_it),
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    scope.launch {
                        clipboard.setClipEntry(
                            ClipEntry(ClipData.newPlainText(MESSAGE_CLIP_LABEL, text)),
                        )
                        copied = true
                    }
                },
            ) { Text(if (copied) stringResource(R.string.ui_copied) else stringResource(R.string.ui_copy_all)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.ui_done)) } },
    )
}

@Composable
private fun MessageContent(
    chat: Chat,
    message: Message,
    endsRun: Boolean,
    haptics: Haptics,
    openLink: ((String, Message) -> Unit)?,
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
    openThread: ((ThreadRef) -> Unit)?,
) {
    when (message.kind) {
        Message.Kind.TEXT -> TextBubble(chat.threadId, message, endsRun, openLink, openAttachment)
        Message.Kind.OPTIONS -> if (QuestionCardRules.drawsQuestionCard(message)) {
            QuestionCardView(chat, message, haptics)
        } else {
            CardView(chat, message, haptics)
        }
        Message.Kind.ACTIVITY -> {
            ActivityChip(message.tool, message.threadRef, openThread)
            val claudeInstance = (chat as? Chat.BotChat)?.bot
                ?.let { it.forTask(chat.threadId) ?: it }
                ?.modelSelection?.instanceId
            if (message.tool?.claudeUpdate == true && claudeInstance != null) {
                ClaudeUpdateCard(messageId = message.id, instanceId = claudeInstance)
            }
        }
        Message.Kind.COMPACTION -> ReceiptChip(
            label = message.compaction?.chipText ?: message.text.orEmpty(),
            detail = message.compaction?.summary ?: message.text.orEmpty(),
        )
        Message.Kind.SCREEN -> ScreenShot(chat.threadId, message)
        Message.Kind.DIGEST -> {}
        Message.Kind.UNKNOWN -> if (!message.text.isNullOrEmpty()) {
            TextBubble(chat.threadId, message, endsRun, openLink, openAttachment)
        }
    }
}

@Composable
private fun TextBubble(
    threadId: String,
    message: Message,
    endsRun: Boolean,
    openLink: ((String, Message) -> Unit)?,
    openAttachment: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
) {
    val mine = message.role == Message.Role.USER
    val tail = TranscriptLayout.tail(message, endsRun)
    val card = remember(message.id, message.role, message.text) { TranscriptCards.of(message) }
    val attached = remember(message.id, message.text) { AttachedMessageContent.parse(message.text.orEmpty()) }
    val webhook = remember(message) { message.webhookContent }
    val bubble = card == null
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        if (mine) Spacer(Modifier.width(56.dp))
        Column(
            modifier = Modifier
                .weight(1f, fill = false)
                .widthIn(max = 640.dp)
                .padding(bottom = if (bubble && endsRun) SpeechBubble.tailDrop() else 0.dp)
                .then(
                    if (bubble) {
                        Modifier
                            .background(
                                if (mine) BubbleColor.mine else BubbleColor.theirs,
                                SpeechBubbleShape.of(tail),
                            )
                            .padding(horizontal = 15.dp, vertical = 11.dp)
                    } else {
                        Modifier
                    },
                ),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (!mine) {
                message.from?.let {
                    Text(
                        text = it.name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(MausPalette.argb(it.color)),
                    )
                }
            }
            message.voiceNotes.forEach { note ->
                VoiceNoteAttachmentView(threadId, message, note)
            }
            message.generatedImages.forEach { attachment ->
                SharedAttachmentView(threadId, message, attachment, openAttachment)
            }
            when (card) {
                is TranscriptCard.Diff -> DiffCard(card)
                is TranscriptCard.Table -> DataTableCard(card)
                null -> if (webhook != null) {
                    WebhookMessageBody(webhook)
                } else if (mine) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        attached.attachments.forEach { attachment ->
                            SharedAttachmentView(
                                threadId = threadId,
                                message = message,
                                attachment = attachment,
                                onOpen = openAttachment,
                            )
                        }
                        if (attached.text.isNotEmpty()) {
                            SelectionContainer {
                                Text(
                                    text = attached.text,
                                    fontSize = 17.sp,
                                    color = BubbleColor.mineText,
                                )
                            }
                        }
                    }
                } else {
                    SelectionContainer {
                        MarkdownText(
                            source = message.text.orEmpty(),
                            openLink = openLink?.let { open -> { url -> open(url, message) } },
                        )
                    }
                }
            }
        }
        if (!mine) Spacer(Modifier.width(44.dp))
    }
}

@Composable
private fun SharedAttachmentView(
    threadId: String,
    message: Message,
    attachment: DisplayedMessageAttachment,
    onOpen: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
) {
    if (attachment.kind == DisplayedMessageAttachment.Kind.IMAGE) {
        SharedImageAttachment(threadId, message, attachment, onOpen)
        return
    }
    Row(
        modifier = Modifier
            .widthIn(max = 360.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(BubbleColor.mineText.copy(alpha = 0.10f))
            .clickable(enabled = onOpen != null, role = Role.Button) {
                onOpen?.invoke(attachment, message, null)
            }
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .semantics { contentDescription = "File attachment: ${attachment.name}. Tap to preview." },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("FILE", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = BubbleColor.mineText.copy(alpha = 0.68f))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                attachment.name,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = BubbleColor.mineText,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(stringResource(R.string.ui_tap_to_preview), fontSize = 12.sp, color = BubbleColor.mineText.copy(alpha = 0.68f))
        }
    }
}

private sealed interface AttachmentThumbnailState {
    data object Loading : AttachmentThumbnailState
    data class Ready(val file: DownloadedFile, val image: ImageBitmap) : AttachmentThumbnailState
    data object Failed : AttachmentThumbnailState
}

@Composable
private fun SharedImageAttachment(
    threadId: String,
    message: Message,
    attachment: DisplayedMessageAttachment,
    onOpen: ((DisplayedMessageAttachment, Message, DownloadedFile?) -> Unit)?,
) {
    val foreground = if (message.role == Message.Role.USER) BubbleColor.mineText else MaterialTheme.colorScheme.onSurface
    val session = LocalCompanion.current.session
    var attempt by remember(message.id, attachment.path) { mutableStateOf(0) }
    var state by remember(message.id, attachment.path) {
        mutableStateOf<AttachmentThumbnailState>(AttachmentThumbnailState.Loading)
    }
    LaunchedEffect(threadId, message.id, attachment.path, attempt) {
        state = AttachmentThumbnailState.Loading
        val downloaded = session.downloadFile(
            threadId,
            message.id,
            attachment.path,
            reportError = false,
            cacheResult = true,
        )
        if (downloaded == null) {
            state = AttachmentThumbnailState.Failed
            return@LaunchedEffect
        }
        val bitmap = withContext(Dispatchers.Default) {
            decodeAttachmentImage(downloaded.data, AttachmentImageRules.THUMBNAIL_EDGE)
        }
        state = bitmap?.let { AttachmentThumbnailState.Ready(downloaded, it) }
            ?: AttachmentThumbnailState.Failed
    }

    val ready = state as? AttachmentThumbnailState.Ready
    Column(
        modifier = Modifier
            .widthIn(max = 360.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(foreground.copy(alpha = 0.10f))
            .clickable(enabled = ready != null && onOpen != null, role = Role.Button) {
                ready?.let { onOpen?.invoke(attachment, message, it.file) }
            }
            .semantics { contentDescription = "Image attachment: ${attachment.name}. Tap to preview." },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(4f / 3f),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = state) {
                AttachmentThumbnailState.Loading ->
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                AttachmentThumbnailState.Failed -> AttachmentLoadFailure(
                    label = stringResource(R.string.ui_image_unavailable),
                    foreground = foreground,
                    onRetry = { attempt += 1 },
                )
                is AttachmentThumbnailState.Ready -> Image(
                    bitmap = current.image,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f),
                )
            }
        }
        Text(
            attachment.name,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = foreground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun AttachmentLoadFailure(label: String, foreground: Color = BubbleColor.mineText, onRetry: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(
            imageVector = Icons.Filled.Warning,
            contentDescription = null,
            tint = foreground.copy(alpha = 0.70f),
            modifier = Modifier.size(20.dp),
        )
        Text(label, fontSize = 13.sp, color = foreground.copy(alpha = 0.80f))
        TextButton(onClick = onRetry) { Text(stringResource(R.string.ui_retry)) }
    }
}

private sealed interface VoiceNoteClipState {
    data object NotLoaded : VoiceNoteClipState
    data object Loading : VoiceNoteClipState
    data class Ready(val data: ByteArray) : VoiceNoteClipState
    data object Failed : VoiceNoteClipState
}

private fun voiceNoteClock(ms: Long): String {
    if (ms <= 0) return "0:00"
    val wholeSeconds = ms / 1000
    return (wholeSeconds / 60).toString() + ":" + (wholeSeconds % 60).toString().padStart(2, '0')
}


@Composable
private fun VoiceNoteAttachmentView(
    threadId: String,
    message: Message,
    note: DisplayedMessageAttachment,
) {
    val foreground = if (message.role == Message.Role.USER) BubbleColor.mineText else MaterialTheme.colorScheme.onSurface
    val session = LocalCompanion.current.session
    val player = LocalCompanion.current.voiceNotes
    val scope = rememberCoroutineScope()
    val key = remember(message.id, note.path) { message.id + ":" + note.path }
    var clip by remember(message.id, note.path) { mutableStateOf<VoiceNoteClipState>(VoiceNoteClipState.NotLoaded) }
    var scrub by remember(key) { mutableStateOf<Float?>(null) }

    fun startPlayback(data: ByteArray) {
        if (player.play(key, data) != null) clip = VoiceNoteClipState.Failed
    }

    fun loadAndPlay() {
        clip = VoiceNoteClipState.Loading
        scope.launch {
            val downloaded = session.downloadFile(
                threadId,
                message.id,
                note.path,
                reportError = false,
                cacheResult = true,
            )
            if (downloaded == null) {
                clip = VoiceNoteClipState.Failed
            } else {
                clip = VoiceNoteClipState.Ready(downloaded.data)
                startPlayback(downloaded.data)
            }
        }
    }

    val active = player.playback.collectAsState().value?.takeIf { it.key == key }
    val playing = active?.playing == true

    LaunchedEffect(key) {
        player.playbackErrors.collectLatest {
            if (it.key == key) clip = VoiceNoteClipState.Failed
        }
    }
    LaunchedEffect(key, playing) {
        while (playing) {
            player.refresh()
            delay(200)
        }
    }

    if (clip is VoiceNoteClipState.Failed) {
        AttachmentLoadFailure(
            label = "Voice note unavailable",
            foreground = foreground,
            onRetry = { clip = VoiceNoteClipState.NotLoaded },
        )
        return
    }

    val durationMs = active?.durationMs ?: note.durationMs?.toLong()?.takeIf { it > 0 }
    val durationSeconds = durationMs?.let { it / 1000f } ?: 0f
    val positionMs = scrub?.toLong() ?: (active?.positionMs ?: 0L)

    Row(
        modifier = Modifier
            .widthIn(max = 360.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(foreground.copy(alpha = 0.10f))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .clickable(role = Role.Button) {
                    when {
                        playing -> player.pause()
                        clip is VoiceNoteClipState.Loading -> Unit
                        active != null && player.resumable(key) ->
                            if (player.resume() != null) clip = VoiceNoteClipState.Failed
                        clip is VoiceNoteClipState.Ready ->
                            startPlayback((clip as VoiceNoteClipState.Ready).data)
                        else -> loadAndPlay()
                    }
                }
                .semantics {
                    contentDescription = if (playing) "Pause voice note" else "Play voice note"
                },
            contentAlignment = Alignment.Center,
        ) {
            when {
                clip is VoiceNoteClipState.Loading && active == null ->
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = Color.White,
                    )
                playing -> VoiceNotePauseGlyph(Color.White)
                else -> Icon(
                    imageVector = Icons.Filled.PlayArrow,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Slider(
            value = if (durationSeconds > 0f) (positionMs / 1000f).coerceIn(0f, durationSeconds) else 0f,
            valueRange = if (durationSeconds > 0f) 0f..durationSeconds else 0f..1f,
            onValueChange = { scrub = it * 1000f },
            onValueChangeFinished = {
                val target = scrub
                scrub = null
                if (target != null && active != null) player.seek(key, target.toLong())
            },
            enabled = active != null && durationMs != null,
            modifier = Modifier
                .weight(1f)
                .semantics { contentDescription = "Seek voice note" },
        )
        Text(
            voiceNoteClock(positionMs) + " / " + (durationMs?.let(::voiceNoteClock) ?: "--:--"),
            fontSize = 11.sp,
            color = foreground.copy(alpha = 0.80f),
        )
    }
}

@Composable
private fun VoiceNotePauseGlyph(color: Color) {
    Canvas(modifier = Modifier.size(14.dp)) {
        val bar = size.width / 5f
        val gap = size.width / 5f
        drawRoundRect(
            color = color,
            topLeft = Offset.Zero,
            size = Size(bar, size.height),
            cornerRadius = CornerRadius(bar / 2f),
        )
        drawRoundRect(
            color = color,
            topLeft = Offset(bar + gap, 0f),
            size = Size(bar, size.height),
            cornerRadius = CornerRadius(bar / 2f),
        )
    }
}

@Composable
private fun ActivityChip(
    tool: ToolActivity?,
    threadRef: ThreadRef? = null,
    openThread: ((ThreadRef) -> Unit)? = null,
) {
    if (tool == null) return
    val status = ActivityReceipt.status(tool.ok)
    val tint = when (status) {
        ActivityStatus.RUNNING -> MaterialTheme.colorScheme.tertiary
        ActivityStatus.SUCCESS -> secondaryTint
        ActivityStatus.ERROR -> MaterialTheme.colorScheme.error
    }
    val haptics = rememberHaptics()
    val linked = if (threadRef != null && openThread != null) {
        Modifier
            .heightIn(min = MIN_TOUCH_TARGET)
            .clickable(role = Role.Button) {
                haptics.play(TactileAction.OPEN_THREAD_CHIP)
                openThread(threadRef)
            }
    } else {
        Modifier
    }
    Row(
        modifier = Modifier
            .padding(start = 4.dp)
            .then(linked)
            .semantics(mergeDescendants = true) {
                contentDescription = ActivityReceipt.announcement(tool.name, status)
            },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (status == ActivityStatus.ERROR) {
            Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(14.dp),
            )
        } else {
            Box(
                modifier = Modifier
                    .size(ACTIVITY_DOT)
                    .background(tint, CircleShape),
            )
        }
        Text(
            text = tool.name,
            fontSize = 13.sp,
            maxLines = 1,
            color = if (status == ActivityStatus.ERROR) tint else secondaryTint,
        )
        if (ActivityReceipt.showsLabel(status)) {
            Text(
                text = ActivityReceipt.label(status),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                color = tint,
            )
        }
    }
}

@Composable
private fun ReceiptChip(label: String, detail: String) {
    if (label.isEmpty()) return
    var expanded by remember(label) { mutableStateOf(false) }
    val haptics = rememberHaptics()
    Column(
        modifier = Modifier
            .padding(start = 4.dp)
            .heightIn(min = MIN_TOUCH_TARGET)
            .clickable(role = Role.Button) {
                haptics.play(TactileAction.TOGGLE_ACTIVITY_RUN)
                expanded = !expanded
            }
            .semantics(mergeDescendants = true) { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(ACTIVITY_DOT)
                    .background(secondaryTint, CircleShape),
            )
            Text(text = label, fontSize = 13.sp, maxLines = 1, color = secondaryTint)
        }
        if (expanded && detail.isNotEmpty() && detail != label) {
            Text(text = detail, fontSize = 12.sp, color = secondaryTint)
        }
    }
}

@Composable
fun ActivityRunChip(items: List<Message>, openThread: ((ThreadRef) -> Unit)? = null) {
    if (items.isEmpty()) return
    val haptics = rememberHaptics()
    var expanded by remember(items.first().id) { mutableStateOf(false) }
    val running = items.any { it.tool?.ok == null }
    val summary = if (running) "Running ${items.size} steps" else "Ran ${items.size} steps"
    Column(
        modifier = Modifier.padding(start = 4.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            modifier = Modifier
                .heightIn(min = MIN_TOUCH_TARGET)
                .clickable(role = Role.Button) {
                    expanded = !expanded
                    haptics.play(TactileAction.TOGGLE_ACTIVITY_RUN)
                }
                .semantics {
                    contentDescription = "$summary, ${if (expanded) "expanded" else "collapsed"}"
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(
                modifier = Modifier
                    .background(secondaryTint.copy(alpha = 0.10f), RoundedCornerShape(18.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (running) {
                    CircularProgressIndicator(modifier = Modifier.size(13.dp), strokeWidth = 1.5.dp)
                } else {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = Color(0xFF22C55E),
                        modifier = Modifier.size(14.dp),
                    )
                }
                Text(summary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Text(if (expanded) "Hide" else "Show", fontSize = 12.sp, color = secondaryTint)
            }
        }
        if (expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items.forEach { item -> ActivityChip(item.tool, item.threadRef, openThread) }
            }
        }
    }
}

private val ACTIVITY_DOT = 7.dp

@Composable
private fun CardView(chat: Chat, message: Message, haptics: Haptics) {
    val card = message.card ?: return
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var answering by remember(message.id) { mutableStateOf(false) }
    val skillRequest = card.skillRequest

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(secondaryTint.copy(alpha = 0.13f), RoundedCornerShape(22.dp))
            .then(
                if (card.isPending) {
                    Modifier.border(
                        1.5.dp,
                        MaterialTheme.colorScheme.primary,
                        RoundedCornerShape(22.dp),
                    )
                } else {
                    Modifier
                },
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(card.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        SelectionContainer {
            Text(card.subtitle, fontSize = 15.sp, color = secondaryTint)
        }

        card.held?.let {
            Text(it, fontSize = 13.sp, color = Color(MausPalette.argb("orange")))
        }

        skillRequest?.let { skill ->
            val reviewed = skill.reviewedSha256
            if (reviewed != null) {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Review the complete SKILL.md",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "sha256 ${reviewed.take(8)}",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = secondaryTint,
                        )
                    }
                    SelectionContainer {
                        Text(
                            "Source: ${skill.source ?: "Unknown"}",
                            fontSize = 11.sp,
                            color = secondaryTint,
                        )
                    }
                    SelectionContainer {
                        Text(
                            skill.preview.orEmpty(),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 220.dp)
                                .verticalScroll(rememberScrollState())
                                .background(
                                    secondaryTint.copy(alpha = 0.08f),
                                    RoundedCornerShape(10.dp),
                                )
                                .padding(10.dp),
                        )
                    }
                    skill.references.orEmpty().forEach { file ->
                        SelectionContainer {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(file.path, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                                Text(
                                    file.content,
                                    fontSize = 12.sp,
                                    fontFamily = FontFamily.Monospace,
                                    modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp)
                                        .verticalScroll(rememberScrollState()).padding(10.dp),
                                )
                            }
                        }
                    }
                }
            } else {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = Color(MausPalette.argb("orange")),
                    )
                    Text(
                        "This proposal was created by an older build and cannot be safely enabled. " +
                            "Deny it and ask the bot to create it again.",
                        fontSize = 12.sp,
                        color = Color(MausPalette.argb("orange")),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        if (card.isPending) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                card.options.forEach { option ->
                    val refusal = ApprovalChoices.emphasis(option) == OptionEmphasis.SECONDARY
                    Button(
                        onClick = {
                            haptics.play(TactileAction.CHOOSE_APPROVAL)
                            answering = true
                            scope.launch {
                                ApprovalAnswers.choose(session, chat, card, option)
                                answering = false
                            }
                        },
                        enabled = !answering && (
                            skillRequest == null ||
                                refusal ||
                                skillRequest.reviewedSha256 != null
                            ),
                        // Same `isRefusal` that picks the allow choice picks the
                        // weight, so the most sensible action on the most
                        // sensitive screen is not the same shape as the refusal.
                        colors = if (refusal) {
                            ButtonDefaults.filledTonalButtonColors()
                        } else {
                            ButtonDefaults.buttonColors()
                        },
                    ) {
                        Text(option)
                    }
                }
            }

            // The grant key comes from the card. The phone never derives its
            // own, so it cannot permit something subtly wider than the computer
            // would have. The same goes for the answer: it is one of the options
            // the card offered, never a string invented here.
            val alwaysAllow = ApprovalChoices.alwaysAllowChoice(card)
            if (alwaysAllow != null && chat is Chat.BotChat) {
                TextButton(
                    onClick = {
                        haptics.play(TactileAction.GRANT_APPROVAL)
                        answering = true
                        scope.launch {
                            ApprovalAnswers.grant(session, chat, card, alwaysAllow)
                            answering = false
                        }
                    },
                    enabled = !answering,
                ) {
                    Text("Always allow this tool", fontSize = 14.sp)
                }
            }
        } else {
            card.answered?.let {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = secondaryTint,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(it, fontSize = 14.sp, color = secondaryTint)
                }
            }
        }
    }
}

@Composable
private fun ScreenShot(threadId: String, message: Message) {
    val session = LocalCompanion.current.session
    var attempt by remember(message.id) { mutableStateOf(0) }
    var state by remember(message.id) { mutableStateOf<ScreenShotState>(ScreenShotState.Loading) }

    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val renderedWidthPixels = with(LocalDensity.current) { maxWidth.toPx().toInt().coerceAtLeast(1) }
        LaunchedEffect(threadId, message.id, attempt, renderedWidthPixels) {
            state = ScreenShotState.Loading
            val bytes = try {
                message.png?.let { encoded ->
                    withContext(Dispatchers.Default) {
                        runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull()
                    }
                } ?: if (message.hasImage == true) session.image(threadId, message.id) else null
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                null
            }
            val bitmap = bytes?.let {
                withContext(Dispatchers.Default) {
                    decodeScreenShotImage(it, renderedWidthPixels)
                }
            }
            state = bitmap?.let(ScreenShotState::Ready) ?: ScreenShotState.Failed
        }

        val aspectRatio = (state as? ScreenShotState.Ready)?.image?.let { image ->
            image.width.toFloat() / image.height.coerceAtLeast(1).toFloat()
        } ?: (16f / 10f)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(aspectRatio)
                .clip(RoundedCornerShape(16.dp))
                .background(secondaryTint.copy(alpha = 0.13f)),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = state) {
                ScreenShotState.Loading ->
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                ScreenShotState.Failed -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(20.dp),
                    )
                    Text("Screenshot unavailable", fontSize = 13.sp, color = secondaryTint)
                    TextButton(onClick = { attempt += 1 }) { Text("Retry") }
                }
                is ScreenShotState.Ready -> Image(
                    bitmap = current.image,
                    contentDescription = "A frame of this bot's computer",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

private sealed interface ScreenShotState {
    data object Loading : ScreenShotState
    data class Ready(val image: ImageBitmap) : ScreenShotState
    data object Failed : ScreenShotState
}

@Composable
fun StreamingBubble(text: String?, reasoning: String?) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Column(
            modifier = Modifier
                .weight(1f, fill = false)
                .padding(bottom = SpeechBubble.tailDrop())
                .background(BubbleColor.theirs, SpeechBubbleShape.of(BubbleTail.LEADING))
                .padding(horizontal = 15.dp, vertical = 11.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (!reasoning.isNullOrEmpty() && text.isNullOrEmpty()) {
                ThoughtChamber(reasoning = reasoning)
            }
            if (!text.isNullOrEmpty()) {
                MarkdownText(source = text, caret = true)
            }
        }
        Spacer(Modifier.width(44.dp))
    }
}

@Composable
fun WorkingBubble(name: String, color: String) {
    val clock = remember { MausFrameClock() }
    var moving by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val durationScale = coroutineContext[MotionDurationScale]
        snapshotFlow { (durationScale?.scaleFactor ?: 1f) > 0f }
            .collectLatest { live ->
                moving = live
                if (!live) return@collectLatest
                while (true) withFrameNanos(clock.onFrame)
            }
    }

    val dots = Color(MausPalette.argb(color))
    val label = LiveTail.workingLabel(name)
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Box(
            modifier = Modifier
                .padding(bottom = SpeechBubble.tailDrop())
                .background(BubbleColor.theirs, SpeechBubbleShape.of(BubbleTail.LEADING))
                .padding(horizontal = 15.dp, vertical = 11.dp)
                .semantics {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
        ) {
            Canvas(modifier = Modifier.size(WORKING_DOTS_WIDTH, WORKING_DOT)) {
                val elapsed = clock.nanos.longValue
                val live = moving
                val radius = size.height * 0.5f
                val step = size.height + WORKING_DOT_GAP.toPx()
                for (index in 0 until WorkingDots.COUNT) {
                    drawCircle(
                        color = dots,
                        radius = radius,
                        center = Offset(radius + index * step, radius),
                        alpha = WorkingDots.alpha(index, elapsed, live),
                    )
                }
            }
        }
        Spacer(Modifier.width(44.dp))
    }
}

private val WORKING_DOT = 7.dp
private val WORKING_DOT_GAP = 5.dp
private val WORKING_DOTS_WIDTH =
    WORKING_DOT * WorkingDots.COUNT + WORKING_DOT_GAP * (WorkingDots.COUNT - 1)
