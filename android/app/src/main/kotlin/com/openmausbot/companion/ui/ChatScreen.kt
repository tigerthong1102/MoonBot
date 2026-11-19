// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.view.KeyCharacterMap
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.openmausbot.companion.R
import com.openmausbot.companion.core.AttachmentPolicy
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatTarget
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Dictation
import com.openmausbot.companion.core.DisplayedMessageAttachment
import com.openmausbot.companion.core.DownloadedFile
import com.openmausbot.companion.core.LocalMessageLink
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.PendingMessageAttachment
import com.openmausbot.companion.core.QueuedSend
import com.openmausbot.companion.core.ThreadRef
import com.openmausbot.companion.core.TranscriptRow
import com.openmausbot.companion.core.target
import com.openmausbot.companion.core.transcriptRows
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ChatScreen(
    destination: Destination.Conversation,
    onResolved: (ChatTarget) -> Unit,
    onBack: () -> Unit,
    onOpenComputer: (String) -> Unit,
    onOpenOverview: (String) -> Unit,
    retainsDraft: (chatId: String) -> Boolean = { false },
    onOpenChat: (Chat) -> Unit = {},
) {
    val session = LocalCompanion.current.session
    val state by session.state.collectAsState()

    val resolution = remember(state, destination) {
        ThreadResolution.resolve(state, destination)
    }
    when (resolution) {
        ThreadResolution.Result.Waiting -> OpeningThread(onBack)
        ThreadResolution.Result.Gone -> LaunchedEffect(destination) { onBack() }
        is ThreadResolution.Result.Open -> {
            val resolved = (destination as? Destination.Thread)?.let { resolution.chat.target }
            LaunchedEffect(resolved) { if (resolved != null) onResolved(resolved) }
            LoadedChat(resolution.chat, state, onBack, onOpenComputer, onOpenOverview, retainsDraft, onResolved, onOpenChat)
        }
    }
}

@Composable
private fun OpeningThread(onBack: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BackPill(unreadElsewhere = 0, onBack = onBack)
        }
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun LoadedChat(
    chat: Chat,
    state: CompanionState,
    onBack: () -> Unit,
    onOpenComputer: (String) -> Unit,
    onOpenOverview: (String) -> Unit,
    retainsDraft: (chatId: String) -> Boolean,
    onSelectTask: (ChatTarget) -> Unit,
    onOpenChat: (Chat) -> Unit,
) {
    val threadId = chat.threadId
    val chatId = chat.id
    val draftKey = chat.threadId
    val environment = LocalCompanion.current
    val session = environment.session
    val dictation = environment.dictation
    val chatDrafts = environment.chatDrafts
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var threadOpenJob by remember { mutableStateOf<Job?>(null) }
    DisposableEffect(threadId) {
        onDispose { threadOpenJob?.cancel() }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    val queuedSends = state.pendingQueued[threadId].orEmpty()
    val steeringInstanceIds by session.steeringInstanceIds.collectAsState()
    val steerTarget = (chat as? Chat.BotChat)?.bot
    val engineCanSteer = steerTarget?.modelSelection?.instanceId
        ?.let { it in steeringInstanceIds }
        ?: false
    var steering by remember(threadId) { mutableStateOf(false) }
    LaunchedEffect(queuedSends.size, chat.busy) {
        if (queuedSends.isEmpty() || !chat.busy) steering = false
    }
    LaunchedEffect(steering) {
        if (steering) {
            delay(20_000)
            steering = false
        }
    }
    val steerNow: (() -> Unit)? = steerTarget?.let { target ->
        {
            haptics.play(HapticCue.SELECT)
            dictation.stop()
            steering = true
            scope.launch { session.interrupt(target) }
        }
    }
    var showingTasks by remember { mutableStateOf(false) }
    var creatingThread by remember(chatId) { mutableStateOf(false) }
    var showingProfile by rememberSaveable { mutableStateOf(false) }
    var showingPlus by remember(threadId) { mutableStateOf(false) }
    var showingCall by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current

    val attachmentDraft = remember(draftKey, chatDrafts) {
        chatDrafts.register(chatId, draftKey)
        chatDrafts.attachments(draftKey)
    }
    val attachments = attachmentDraft.items
    var preparingAttachments by attachmentDraft.preparing
    var sendingMessage by attachmentDraft.sending
    var attachmentError by attachmentDraft.error
    var pickerDraft by remember { mutableStateOf(attachmentDraft) }
    var openingFileName by remember(threadId) { mutableStateOf<String?>(null) }
    var fileOpenError by remember(threadId) { mutableStateOf<String?>(null) }
    var filePreview by remember(threadId) { mutableStateOf<FilePreviewItem?>(null) }
    var fileDownloadJob by remember(threadId) { mutableStateOf<Job?>(null) }
    val filePreviews = remember(context) { FilePreviews(context) }
    DisposableEffect(filePreviews) {
        onDispose {
            fileDownloadJob?.cancel()
            filePreviews.clear()
        }
    }
    DisposableEffect(filePreviews, threadId) {
        onDispose {
            filePreviews.invalidateCurrent()
            fileDownloadJob?.cancel()
        }
    }
    val canAddAttachment = AttachmentImportRules.canAdd(attachments.size, preparingAttachments, sendingMessage)

    suspend fun importInto(target: ChatDraftHolder.Attachments, count: Int, read: suspend (Int, Int) -> PendingMessageAttachment) {
        if (target.preparing.value || target.sending.value) return
        val existing = target.items.toList()
        if (count > AttachmentPolicy.MAXIMUM_ITEMS - existing.size) {
            target.error.value = AttachmentImportRules.TOO_MANY
            return
        }
        target.preparing.value = true
        target.error.value = null
        try {
            val imported = mutableListOf<PendingMessageAttachment>()
            for (index in 0 until count) {
                val remaining = AttachmentImportRules.remainingBytes(existing + imported)
                val candidate = withContext(Dispatchers.IO) { read(index, remaining) }
                AttachmentPolicy.validate(existing + imported + candidate)
                imported += candidate
            }
            target.items += imported
            haptics.play(HapticCue.SELECT)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            target.error.value = error.message ?: "Couldn't add that attachment."
        } finally {
            target.preparing.value = false
        }
    }

    val pickPhotos = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(AttachmentPolicy.MAXIMUM_ITEMS),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val target = pickerDraft
        scope.launch {
            importInto(target, uris.size) { index, remaining ->
                AttachmentImport.readPhoto(context.contentResolver, uris[index], index, uris.size, remaining)
            }
        }
    }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val target = pickerDraft
        scope.launch {
            importInto(target, uris.size) { index, remaining ->
                AttachmentImport.readDocument(context.contentResolver, uris[index], remaining)
            }
        }
    }

    /** Every computer-local attachment takes the authenticated message-file route. */
    fun openFile(
        path: String,
        message: Message,
        prepared: DownloadedFile? = null,
        preferredName: String? = null,
        cacheResult: Boolean = false,
    ) {
        val requestGeneration = filePreviews.beginRequest()
        val requestedThreadId = threadId
        fileDownloadJob?.cancel()
        fileOpenError = null
        openingFileName = preferredName ?: prepared?.filename ?: FilePreviewRules.nameForOpening(path)
        fileDownloadJob = scope.launch {
            val fetched = prepared ?: session.downloadFile(
                requestedThreadId,
                message.id,
                path,
                cacheResult = cacheResult,
            )
            if (!filePreviews.isCurrent(requestGeneration)) return@launch
            openingFileName = null
            if (fetched == null) {
                fileOpenError = session.actionError ?: "Couldn't open that file. Try again."
                session.actionError = null
                return@launch
            }
            val item = try {
                withContext(Dispatchers.IO) { filePreviews.store(fetched, requestGeneration) }
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (_: Throwable) {
                if (!filePreviews.isCurrent(requestGeneration)) return@launch
                fileOpenError = "The downloaded file couldn't be previewed."
                return@launch
            } ?: return@launch
            if (!filePreviews.isCurrent(requestGeneration)) return@launch
            filePreview = item
        }
    }

    fun openLink(url: String, message: Message) {
        when (val target = LocalMessageLink.resolve(url)) {
            is LocalMessageLink.Web -> runCatching { uriHandler.openUri(target.url) }
                .onFailure { fileOpenError = "This link can't be opened on this phone." }
            is LocalMessageLink.DesktopFile -> openFile(target.path, message)
            null -> fileOpenError = "This link can't be opened securely."
        }
    }

    fun openAttachment(
        attachment: DisplayedMessageAttachment,
        message: Message,
        downloaded: DownloadedFile?,
    ) = openFile(
        attachment.path,
        message,
        downloaded,
        preferredName = attachment.name,
        cacheResult = true,
    )

    fun openThread(ref: ThreadRef) {
        threadOpenJob?.cancel()
        threadOpenJob = scope.launch {
            val bot = session.openThread(ref) ?: return@launch
            if (bot.id == chatId) onSelectTask(ChatTarget.Bot(bot.id, bot.threadId)) else onOpenChat(Chat.BotChat(bot))
        }
    }
    val focusedMessageId by session.focusedMessageId.collectAsState()

    val dictationListening by dictation.isListening.collectAsState()
    val dictationStarting by dictation.isStarting.collectAsState()
    val dictationError by dictation.error.collectAsState()
    val dictationLocked = dictationListening || dictationStarting

    val rawTranscript = remember(state, threadId) { state.visibleTranscript(threadId) }
    val activityDetail by environment.chatPreferences.activityDetail.collectAsState()
    val quickReplies by environment.chatPreferences.quickReplies.collectAsState()
    val transcript = remember(rawTranscript, activityDetail) {
        transcriptRows(rawTranscript, activityDetail)
    }
    var expandedTurns by remember(threadId) { mutableStateOf(emptySet<String>()) }
    var revealedTurnMessageId by remember(threadId) { mutableStateOf<String?>(null) }
    val predictiveChips = remember(quickReplies) {
        quickReplies.map { PredictiveChip(title = it.title, prompt = it.prompt, icon = it.icon) }
    }
    val streaming = state.streaming[threadId]
    val reasoning = state.reasoning[threadId]
    val tail = LiveTail.of(streaming = streaming, reasoning = reasoning, busy = chat.busy, detail = activityDetail)
    val liveText = streaming?.takeIf { tail == TranscriptTail.STREAM }
    val liveReasoning = reasoning?.takeIf { tail == TranscriptTail.REASONING }
    val hasMore = state.hasMore[threadId] == true
    val pendingApproval = remember(rawTranscript) {
        ComposerAccessories.hasPendingApproval(rawTranscript)
    }

    val heldOnEntry = remember(draftKey, chatDrafts) { chatDrafts.get(draftKey) }
    val composerSaver = remember(draftKey, chatDrafts) {
        ChatComposerDraft.saver(draftKey, chatDrafts)
    }
    val composer = rememberSaveable(draftKey, chatDrafts, saver = composerSaver) {
        chatDrafts.composer(
            draftKey,
            initialSaveable = heldOnEntry?.typedSnapshot.orEmpty(),
        )
    }
    val draft = composer.text
    var hudOpen by remember(draftKey, chatDrafts) {
        mutableStateOf(SlashCommands.openOnEntry(composer.text))
    }
    val listState = rememberLazyListState()

    fun publishFrom(composerDraft: ChatComposerDraft) {
        hudOpen = SlashCommands.opensOnDraft(composerDraft.text)
    }

    DisposableEffect(lifecycleOwner, threadId) {
        dictation.bind(lifecycleOwner)
        onDispose { dictation.unbind(lifecycleOwner) }
    }

    DisposableEffect(chatId) {
        onDispose {
            if (!retainsDraft(chatId)) {
                chatDrafts.clearOwner(chatId)
            }
        }
    }

    LaunchedEffect(threadId, dictation) {
        var first = true
        dictation.transcript.collect { next ->
            if (first) {
                first = false
                return@collect
            }
            val merged = Dictation.draft(base = dictation.base, transcript = next)
            composer.onDictation(merged)
            publishFrom(composer)
        }
    }
    LaunchedEffect(dictationListening) {
        if (dictationListening) focusManager.clearFocus()
    }
    LaunchedEffect(showingPlus) { if (showingPlus) dictation.stop() }
    LaunchedEffect(showingTasks) { if (showingTasks) dictation.stop() }
    LaunchedEffect(showingProfile) { if (showingProfile) dictation.stop() }
    LaunchedEffect(showingCall) { if (showingCall) dictation.stop() }

    val connection by session.connection.collectAsState()
    LaunchedEffect(chatId, threadId, connection?.id) {
        environment.chatPreferences.rememberThread(chat, connection?.id)
    }

    LaunchedEffect(threadId, chat.unread) {
        if (chat.unread) session.markRead(chat)
    }
    LaunchedEffect(threadId, state.hasLoadedPage(threadId)) {
        session.loadThreadIfNeeded(threadId)
    }

    val headerCount = if (hasMore) 1 else 0
    val liveCount = if (tail == TranscriptTail.NONE) 0 else 1
    val itemCount = headerCount + transcript.size + liveCount

    var settled by remember(threadId) { mutableStateOf(false) }
    LaunchedEffect(threadId, itemCount) {
        if (settled || itemCount == 0) return@LaunchedEffect
        listState.scrollToItem(itemCount - 1)
        settled = true
    }
    LaunchedEffect(threadId, transcript.lastOrNull()?.id) {
        if (!settled || itemCount == 0) return@LaunchedEffect
        listState.animateScrollToItem(itemCount - 1)
    }
    LaunchedEffect(threadId, tail, liveText?.length ?: 0) {
        if (liveCount == 0 || itemCount == 0) return@LaunchedEffect
        listState.scrollToItem(itemCount - 1)
    }
    LaunchedEffect(focusedMessageId, transcript.size) {
        val target = focusedMessageId ?: return@LaunchedEffect
        val index = transcript.indexOfFirst { row ->
            row.id == target || row.containsMessage(target)
        }
        if (index < 0) return@LaunchedEffect
        val turn = transcript[index] as? TranscriptRow.AssistantTurn
        if (turn != null) expandedTurns = expandedTurns + turn.turnId
        listState.scrollToItem(headerCount + index)
        if (turn != null) {
            revealedTurnMessageId = target
        } else {
            session.consumeFocus(target)
        }
        settled = true
    }

    val bot = (chat as? Chat.BotChat)?.bot
    val commands = SlashCommands.forChat(chat)
    val onAction: (ChatActionId) -> Unit = { action ->
        when (action) {
            ChatActionId.PHOTOS -> {
                pickerDraft = attachmentDraft
                pickPhotos.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            }
            ChatActionId.FILES -> {
                pickerDraft = attachmentDraft
                pickFiles.launch(
                (AttachmentPolicy.IMAGE_MIME_TYPES + AttachmentPolicy.DOCUMENT_MIME_TYPES).toTypedArray(),
                )
            }
            ChatActionId.NEW_TASK -> if (!creatingThread && TaskRules.canCreate(chat)) {
                creatingThread = true
                scope.launch {
                    try {
                        val created = when (chat) {
                            is Chat.BotChat -> session.createTask(chat.bot, null)?.let(Chat::BotChat)
                            is Chat.RoomChat -> if (chat.supportsTasks) session.createTask(chat.room, null)
                                ?.let(Chat::RoomChat) else null
                        }
                        if (created == null) {
                            attachmentError = session.actionError ?: "Couldn't create this thread. Try again."
                            session.actionError = null
                        } else onSelectTask(created.target)
                    } finally {
                        creatingThread = false
                    }
                }
            }
            ChatActionId.TASKS -> showingTasks = true
            ChatActionId.WATCH_COMPUTER -> {
                dictation.stop()
                if (bot != null) onOpenComputer(bot.id)
            }
            ChatActionId.SETTINGS -> if (bot != null) showingProfile = true
            ChatActionId.SHARE_MARKDOWN -> share(scope, environment, threadId, ShareFormat.MARKDOWN)
            ChatActionId.SHARE_JSON -> share(scope, environment, threadId, ShareFormat.JSON)
            ChatActionId.INTERRUPT -> if (bot != null) scope.launch { session.interrupt(bot) }
        }
        Unit
    }

    fun clearDraft() {
        composer.onTypedChange("")
        publishFrom(composer)
    }

    fun submit(explicitText: String? = null) {
        // Cancels an in-flight permission prompt before it can open the
        // microphone after the message has already been sent.
        dictation.stop()
        val text = (explicitText ?: draft).trim()
        if (text.isEmpty() && attachments.isEmpty()) return
        if (preparingAttachments || sendingMessage) return
        val outgoing = attachments.toList()
        val draftAtSend = draft
        val originConnectionId = connection?.id
        sendingMessage = true
        attachmentError = null
        showingPlus = false
        scope.launch {
            val sent = try {
                session.send(text, outgoing, chat, originConnectionId)
            } finally {
                sendingMessage = false
            }
            if (composer.onSendResult(sent, draftAtSend)) publishFrom(composer)
            if (!sent) {
                attachmentError = session.actionError ?: "Couldn't send this message. Try again."
                session.actionError = null
                return@launch
            }
            if (attachments.map { it.id } == outgoing.map { it.id }) attachments.clear()
            haptics.play(HapticCue.SEND)
        }
    }

    fun selectCommand(command: SlashCommand) {
        CompanionHaptics.forCommand(command.effect)?.let { haptics.play(it) }
        when (val effect = command.effect) {
            SlashEffect.OpenComputer -> {
                dictation.stop()
                clearDraft()
                if (bot != null) onOpenComputer(bot.id)
            }

            SlashEffect.OpenTasks -> {
                dictation.stop()
                clearDraft()
                showingTasks = true
            }

            is SlashEffect.Send -> submit(effect.prompt)
        }
        hudOpen = false
    }

    fun closeHud() {
        val next = SlashCommands.draftAfterClose(draft)
        if (next != draft) {
            composer.onTypedChange(next)
            publishFrom(composer)
        }
        hudOpen = false
    }

    fun leaveToRoster() {
        composer.onLeaveToRoster()
        publishFrom(composer)
        onBack()
    }

    BackHandler(enabled = showingPlus) { showingPlus = false }
    BackHandler(enabled = !showingPlus && hudOpen) { closeHud() }
    BackHandler(enabled = !showingPlus && !hudOpen) { leaveToRoster() }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .pointerInput(Unit) {
                        detectTapGestures { focusManager.clearFocus() }
                    },
            ) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .widthIn(max = CHAT_CONTENT_MAX_WIDTH)
                        .fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        top = HEADER_CLEARANCE,
                        bottom = 12.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (hasMore) {
                        item(key = LOAD_EARLIER_KEY) {
                            TextButton(
                                onClick = {
                                    val anchor = transcript.firstOrNull()?.id
                                    scope.launch {
                                        session.loadOlder(threadId)
                                        if (anchor == null) return@launch
                                        val fresh = session.state.value
                                        val freshRows = transcriptRows(
                                            fresh.visibleTranscript(threadId),
                                            activityDetail,
                                        )
                                        val index = freshRows.indexOfFirst { row ->
                                            row.id == anchor || row.containsMessage(anchor)
                                        }
                                        if (index < 0) return@launch
                                        val offset = if (fresh.hasMore[threadId] == true) 1 else 0
                                        listState.scrollToItem(index + offset)
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(stringResource(R.string.ui_load_earlier_messages), fontSize = 13.sp)
                            }
                        }
                    }

                    itemsIndexedKeyed(transcript) { index, message ->
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (TranscriptLayout.startsNewRowStretch(transcript, index)) {
                                Text(
                                    text = RelativeStamp.separator(
                                        message.at,
                                        System.currentTimeMillis(),
                                        locale = Locale.getDefault(),
                                    ),
                                    fontSize = 13.sp,
                                    color = secondaryTint,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 6.dp),
                                    textAlign = TextAlign.Center,
                                )
                            }
                            when (message) {
                                is TranscriptRow.Single -> MessageRow(
                                    chat = chat,
                                    message = message.message,
                                    endsRun = TranscriptLayout.endsRowRun(transcript, index),
                                    openLink = ::openLink,
                                    openAttachment = ::openAttachment,
                                    openThread = ::openThread,
                                )
                                is TranscriptRow.ActivityRun -> ActivityRunChip(message.items, ::openThread)
                                is TranscriptRow.AssistantTurn -> AssistantTurnChip(
                                    turn = message,
                                    chat = chat,
                                    expanded = message.turnId in expandedTurns,
                                    revealMessageId = revealedTurnMessageId,
                                    onRevealed = { target ->
                                        session.consumeFocus(target)
                                        if (revealedTurnMessageId == target) revealedTurnMessageId = null
                                    },
                                    onToggle = {
                                        expandedTurns = if (message.turnId in expandedTurns) expandedTurns - message.turnId
                                            else expandedTurns + message.turnId
                                    },
                                    openLink = ::openLink,
                                    openAttachment = ::openAttachment,
                                    openThread = ::openThread,
                                )
                            }
                        }
                    }

                    if (liveCount == 1) {
                        item(key = LIVE_BUBBLE_KEY) {
                            if (tail == TranscriptTail.WORKING) {
                                WorkingBubble(name = chat.name, color = chat.color)
                            } else {
                                StreamingBubble(text = liveText, reasoning = liveReasoning)
                            }
                        }
                    }
                }

                ChatHeader(
                    chat = chat,
                    face = remember(chat, rawTranscript) {
                        MausState.forChat(chat, rawTranscript.lastOrNull())
                    },
                    unreadElsewhere = remember(state, chat) {
                        (state.unreadCount - if (chat.unread) 1 else 0).coerceAtLeast(0)
                    },
                    onBack = { leaveToRoster() },
                    onOpenThreads = {
                        dictation.stop()
                        focusManager.clearFocus()
                        showingTasks = true
                    },
                    onWatchComputer = {
                        dictation.stop()
                        if (bot != null) onOpenComputer(bot.id)
                    },
                    onCall = {
                        focusManager.clearFocus()
                        showingCall = true
                    },
                    onOpenProfile = {
                        if (bot != null) {
                            showingProfile = true
                        } else {
                            dictation.stop()
                            focusManager.clearFocus()
                            showingPlus = true
                        }
                    },
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .widthIn(max = CHAT_CONTENT_MAX_WIDTH),
                )
            }

            Composer(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .widthIn(max = CHAT_CONTENT_MAX_WIDTH),
                name = chat.name,
                draft = draft,
                accessory = ComposerAccessories.accessory(
                    hudOpen = hudOpen,
                    draft = draft,
                    busy = chat.busy,
                    pendingApproval = pendingApproval,
                    hasQuickReplies = predictiveChips.isNotEmpty(),
                    hasAttachments = attachments.isNotEmpty(),
                ),
                commands = commands,
                chips = predictiveChips,
                plusOpen = showingPlus,
                dictationListening = dictationListening,
                dictationLocked = dictationLocked,
                dictationError = dictationError,
                attachments = attachments,
                sending = sendingMessage,
                preparing = preparingAttachments,
                busy = chat.busy,
                engineCanSteer = engineCanSteer,
                queuedSends = queuedSends,
                steering = steering,
                onSteer = steerNow,
                onCancelQueued = { queued ->
                    scope.launch { session.cancelQueued(queued, chat) }
                },
                onEditQueued = { queued ->
                    val target = composer
                    scope.launch {
                        if (session.cancelQueued(queued, chat)) {
                            target.onTypedChange(queued.editDraft(keeping = target.text))
                            publishFrom(target)
                        }
                    }
                },
                openingFileName = openingFileName,
                attachmentError = fileOpenError ?: attachmentError,
                onRemoveAttachment = { attachment ->
                    if (!preparingAttachments && !sendingMessage) {
                        attachments.removeAll { it.id == attachment.id }
                        attachmentError = null
                    }
                },
                onDismissError = {
                    fileOpenError = null
                    attachmentError = null
                },
                onTogglePlus = {
                    dictation.stop()
                    if (!showingPlus) focusManager.clearFocus()
                    showingPlus = !showingPlus
                },
                onDraftChange = { next ->
                    if (dictationLocked) return@Composer
                    composer.onTypedChange(next)
                    publishFrom(composer)
                },
                onToggleDictation = {
                    focusManager.clearFocus()
                    dictation.toggle(capturing = draft)
                },
                onSend = { submit() },
                onToggleHud = {
                    dictation.stop()
                    haptics.play(HapticCue.SELECT)
                    hudOpen = !hudOpen
                },
                onCloseHud = {
                    haptics.play(HapticCue.SELECT)
                    closeHud()
                },
                onSelectCommand = { selectCommand(it) },
                onSelectChip = { submit(it.prompt) },
            )
        }

        PlusSheet(
            open = showingPlus,
            actions = remember(chat, pendingApproval, canAddAttachment) {
                ChatActions.sheet(chat, hasPendingApproval = pendingApproval, canAddAttachment = canAddAttachment)
            },
            onDismiss = { showingPlus = false },
            onAction = {
                showingPlus = false
                onAction(it)
            },
        )
    }

    if (showingTasks) {
        if (chat.supportsTasks) TaskSheet(chat = chat, onDismiss = { showingTasks = false }, onSelectTask = onSelectTask, onDeletedCurrent = onBack)
    }

    if (showingProfile && bot != null) {
        AgentProfileSheet(
            bot = bot,
            onDismiss = { showingProfile = false },
            onOpenOverview = {
                onOpenOverview(it)
                showingProfile = false
            },
        )
    }

    filePreview?.let { item ->
        FilePreviewSheet(
            item = item,
            onDismiss = {
                filePreview = null
                scope.launch(Dispatchers.IO) { filePreviews.dismiss(item) }
            },
            onShare = { filePreviews.share(item) },
            onOpen = { filePreviews.openWithSystem(item) },
        )
    }

    if (showingCall && bot != null) {
        CallScreen(bot = bot, onDismiss = { showingCall = false })
    }
}

private fun share(
    scope: kotlinx.coroutines.CoroutineScope,
    environment: CompanionEnvironment,
    threadId: String,
    format: ShareFormat,
) {
    scope.launch {
        val session = environment.session
        val exported = session.export(threadId, format.wire) ?: return@launch
        environment.shareTranscript(exported, format)?.let { session.actionError = it }
    }
}

private const val LOAD_EARLIER_KEY = "companion.loadEarlier"
private const val LIVE_BUBBLE_KEY = "companion.live"
private val CHAT_CONTENT_MAX_WIDTH = 840.dp

private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexedKeyed(
    messages: List<TranscriptRow>,
    content: @Composable (Int, TranscriptRow) -> Unit,
) {
    items(
        count = messages.size,
        key = { messages[it].id },
        itemContent = { index -> content(index, messages[index]) },
    )
}

private val HEADER_BAR = 56.dp
private val HEADER_SCRIM_FADE = 24.dp
private val HEADER_CLEARANCE = 128.dp

@Composable
private fun ChatHeader(
    chat: Chat,
    face: MausState,
    unreadElsewhere: Int,
    onBack: () -> Unit,
    onWatchComputer: () -> Unit,
    onCall: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenThreads: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val surface = MaterialTheme.colorScheme.surface
    Box(modifier = modifier.fillMaxWidth()) {
        Spacer(
            modifier = Modifier
                .fillMaxWidth()
                .height(HEADER_BAR + HEADER_SCRIM_FADE)
                .drawWithCache {
                    val solid = HEADER_BAR.toPx() / size.height
                    val brush = Brush.verticalGradient(
                        0f to surface,
                        solid to surface,
                        1f to Color.Transparent,
                    )
                    onDrawBehind { drawRect(brush) }
                },
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.Top,
        ) {
            BackPill(unreadElsewhere = unreadElsewhere, onBack = onBack)
            Spacer(Modifier.weight(1f))
            if (chat is Chat.BotChat) {
                ChromeButton(
                    painter = painterResource(R.drawable.ic_phone),
                    contentDescription = stringResource(R.string.ui_call, chat.name),
                    onClick = onCall,
                )
                Spacer(Modifier.size(8.dp))
                ChromeButton(
                    painter = painterResource(R.drawable.ic_display),
                    contentDescription = stringResource(R.string.ui_watch_s_computer, chat.name),
                    onClick = onWatchComputer,
                )
            } else {
                Spacer(Modifier.size(MIN_TOUCH_TARGET))
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ChatAvatar(
                chat = chat,
                size = 60.dp,
                state = face,
                modifier = if (chat is Chat.BotChat) {
                    Modifier
                        .clickable(role = Role.Button, onClick = onOpenProfile)
                        .semantics { contentDescription = "Open ${chat.name} settings" }
                } else {
                    Modifier
                },
            )
            NamePill(chat = chat, onOpen = if (chat.supportsTasks) onOpenThreads else onOpenProfile)
        }
    }
}

@Composable
private fun BackPill(unreadElsewhere: Int, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .chromeCapsule()
            .clip(CircleShape)
            .heightIn(min = MIN_TOUCH_TARGET)
            .clickable(role = Role.Button, onClick = onBack)
            .padding(
                start = 14.dp,
                end = if (unreadElsewhere > 0) 10.dp else 14.dp,
            ),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = stringResource(R.string.ui_back),
            modifier = Modifier.size(20.dp),
        )
        if (unreadElsewhere > 0) {
            Text(
                text = "$unreadElsewhere",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape)
                    .defaultMinSize(minWidth = 22.dp, minHeight = 22.dp)
                    .padding(horizontal = 7.dp, vertical = 2.dp),
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun NamePill(chat: Chat, onOpen: () -> Unit) {
    val hasThreads = chat.supportsTasks
    Row(
        modifier = Modifier
            .chromeCapsule()
            .clip(CircleShape)
            .heightIn(min = MIN_TOUCH_TARGET)
            .clickable(
                role = Role.Button,
                onClickLabel = if (hasThreads) {
                    "Switch thread"
                } else {
                    "Open ${chat.name} chat options"
                },
                onClick = onOpen,
            )
            .padding(start = 14.dp, end = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = chat.name,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        val subtitle = if (hasThreads) chat.threadTitle else chat.subtitle
        if (subtitle.isNotEmpty()) {
            Text(
                text = subtitle,
                fontSize = 13.sp,
                color = secondaryTint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
        Icon(
            imageVector = if (hasThreads) Icons.Filled.ArrowDropDown else Icons.Filled.MoreVert,
            contentDescription = null,
            tint = secondaryTint,
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun BoxScope.PlusSheet(
    open: Boolean,
    actions: List<ChatAction>,
    onDismiss: () -> Unit,
    onAction: (ChatActionId) -> Unit,
) {
    AnimatedVisibility(
        visible = open,
        enter = fadeIn(tween(PLUS_MILLIS)),
        exit = fadeOut(tween(PLUS_MILLIS)),
        modifier = Modifier.matchParentSize(),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.35f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    role = Role.Button,
                    onClick = onDismiss,
                )
                .semantics { contentDescription = "Close" },
        )
    }

    AnimatedVisibility(
        visible = open,
        enter = slideInVertically(tween(PLUS_MILLIS)) { it / 2 } + fadeIn(tween(PLUS_MILLIS)),
        exit = slideOutVertically(tween(PLUS_MILLIS)) { it / 2 } + fadeOut(tween(PLUS_MILLIS)),
        modifier = Modifier
            .align(Alignment.BottomStart)
            .padding(start = 12.dp, end = 44.dp, bottom = 70.dp),
    ) {
        Column(
            modifier = Modifier
                .chromeSheet()
                .clip(RoundedCornerShape(PLUS_SHEET_RADIUS))
                .padding(vertical = 10.dp),
        ) {
            actions.forEach { action ->
                val tint = if (action.destructive) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurface
                }
                val alpha = if (action.enabled) 1f else 0.45f
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 64.dp)
                        .clickable(
                            enabled = action.enabled,
                            role = Role.Button,
                            onClick = { onAction(action.id) },
                        )
                        .padding(horizontal = 18.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .background(
                                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f * alpha),
                                CircleShape,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        ChatActionIcon(id = action.id, tint = tint.copy(alpha = alpha))
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = stringResource(action.title),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Medium,
                            color = tint.copy(alpha = alpha),
                        )
                        Text(
                            text = action.subject?.let { stringResource(action.subtitle, it) } ?: stringResource(action.subtitle),
                            fontSize = 13.sp,
                            color = secondaryTint.copy(alpha = alpha),
                        )
                    }
                }
            }
        }
    }
}

private const val PLUS_MILLIS = 280
private val PLUS_SHEET_RADIUS = 28.dp

private const val PLUS_TURN_DEGREES = 45f

@Composable
private fun ComposerStatusLine(text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp)
            .semantics(mergeDescendants = true) { },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
        Text(text = text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = secondaryTint, maxLines = 1)
    }
}

@Composable
private fun ChatActionIcon(id: ChatActionId, tint: Color) {
    val modifier = Modifier.size(22.dp)
    when (id) {
        ChatActionId.PHOTOS ->
            Icon(painterResource(R.drawable.ic_photo), null, tint = tint, modifier = modifier)
        ChatActionId.FILES ->
            Icon(painterResource(R.drawable.ic_attach_file), null, tint = tint, modifier = modifier)
        ChatActionId.NEW_TASK ->
            Icon(Icons.Filled.Add, null, tint = tint, modifier = modifier)
        ChatActionId.TASKS ->
            Icon(Icons.AutoMirrored.Filled.List, null, tint = tint, modifier = modifier)
        ChatActionId.WATCH_COMPUTER ->
            Icon(painterResource(R.drawable.ic_display), null, tint = tint, modifier = modifier)
        ChatActionId.SETTINGS ->
            Icon(Icons.Filled.Settings, null, tint = tint, modifier = modifier)
        ChatActionId.SHARE_MARKDOWN, ChatActionId.SHARE_JSON ->
            Icon(Icons.Filled.Share, null, tint = tint, modifier = modifier)
        ChatActionId.INTERRUPT ->
            Icon(Icons.Filled.Close, null, tint = tint, modifier = modifier)
    }
}

@Composable
private fun Composer(
    modifier: Modifier = Modifier,
    name: String,
    draft: String,
    accessory: ComposerAccessory,
    commands: List<SlashCommand>,
    plusOpen: Boolean,
    dictationListening: Boolean,
    dictationLocked: Boolean,
    dictationError: String?,
    onTogglePlus: () -> Unit,
    onDraftChange: (String) -> Unit,
    onToggleDictation: () -> Unit,
    onSend: () -> Unit,
    onToggleHud: () -> Unit,
    onCloseHud: () -> Unit,
    onSelectCommand: (SlashCommand) -> Unit,
    chips: List<PredictiveChip>,
    onSelectChip: (PredictiveChip) -> Unit,
    attachments: List<PendingMessageAttachment>,
    sending: Boolean,
    preparing: Boolean,
    busy: Boolean,
    engineCanSteer: Boolean,
    queuedSends: List<QueuedSend>,
    steering: Boolean,
    onSteer: (() -> Unit)?,
    onCancelQueued: (QueuedSend) -> Unit,
    onEditQueued: (QueuedSend) -> Unit,
    openingFileName: String?,
    attachmentError: String?,
    onRemoveAttachment: (PendingMessageAttachment) -> Unit,
    onDismissError: () -> Unit,
) {
    val canSend = AttachmentImportRules.canSend(draft, attachments.size, preparing, sending)
    val inFlight = preparing || sending
    val turn = animateFloatAsState(
        targetValue = if (plusOpen) PLUS_TURN_DEGREES else 0f,
        animationSpec = tween(PLUS_MILLIS),
        label = "plus",
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (dictationError != null) {
            Text(
                text = dictationError,
                fontSize = 13.sp,
                color = Color(0xFFFF9800),
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        if (inFlight) {
            ComposerStatusLine(if (preparing) stringResource(R.string.ui_preparing_attachments) else stringResource(R.string.ui_sending))
        }
        if (openingFileName != null) {
            ComposerStatusLine(stringResource(R.string.ui_opening, openingFileName))
        }
        if (attachmentError != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFFF9800).copy(alpha = 0.12f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 9.dp)
                    .semantics(mergeDescendants = true) { },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.Warning,
                    contentDescription = null,
                    tint = Color(0xFFFF9800),
                    modifier = Modifier.size(18.dp),
                )
                Text(text = attachmentError, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(
                    text = stringResource(R.string.ui_dismiss),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(role = Role.Button, onClick = onDismissError)
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                )
            }
        }
        queuedSends.forEach { queued ->
            QueuedSendRow(
                send = queued,
                onSteer = onSteer,
                steering = steering,
                onEdit = { onEditQueued(queued) },
                onCancel = { onCancelQueued(queued) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (attachments.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                attachments.forEach { attachment ->
                    PendingAttachmentChip(
                        attachment = attachment,
                        enabled = !inFlight,
                        onRemove = { onRemoveAttachment(attachment) },
                    )
                }
            }
        }
        when (accessory) {
            ComposerAccessory.HUD -> CommandSkillHud(
                commands = commands,
                draft = draft,
                onSelect = onSelectCommand,
                onClose = onCloseHud,
            )

            ComposerAccessory.CHIPS -> PredictiveChipsRow(chips = chips, onSelect = onSelectChip)

            ComposerAccessory.NONE -> Unit
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            TouchTarget(
                onClick = onTogglePlus,
                contentDescription = if (plusOpen) stringResource(R.string.ui_close) else stringResource(R.string.ui_more),
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .chromeCapsule()
                        .then(
                            if (plusOpen) {
                                Modifier.background(MaterialTheme.colorScheme.onSurface, CircleShape)
                            } else {
                                Modifier
                            },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Add,
                        contentDescription = null,
                        tint = if (plusOpen) {
                            MaterialTheme.colorScheme.surface
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                        modifier = Modifier
                            .size(22.dp)
                            .graphicsLayer { rotationZ = turn.value },
                    )
                }
            }

            Row(
                modifier = Modifier
                    .weight(1f)
                    .chromeSheet(cornerRadius = MIN_TOUCH_TARGET / 2)
                    .heightIn(min = MIN_TOUCH_TARGET),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                TouchTarget(
                    onClick = onToggleHud,
                    contentDescription = stringResource(R.string.ui_slash_commands_205),
                    modifier = Modifier.semantics {
                        stateDescription = if (accessory == ComposerAccessory.HUD) {
                            "Expanded"
                        } else {
                            "Collapsed"
                        }
                    },
                ) {
                    Text(
                        text = "/",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        color = if (accessory == ComposerAccessory.HUD) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            secondaryTint
                        },
                    )
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(top = 13.dp, bottom = 13.dp),
                ) {
                    if (draft.isEmpty()) {
                        Text(
                            text = ComposerPromise.placeholder(
                                name = name,
                                busy = busy,
                                engineCanSteer = engineCanSteer,
                                sending = sending,
                                listening = dictationListening,
                            ),
                            fontSize = 17.sp,
                            color = secondaryTint,
                        )
                    }
                    BasicTextField(
                        value = draft,
                        onValueChange = onDraftChange,
                        readOnly = dictationLocked,
                        maxLines = 5,
                        textStyle = LocalTextStyle.current.copy(
                            fontSize = 17.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                        modifier = Modifier
                            .fillMaxWidth()
                            .onPreviewKeyEvent { event ->
                                val sends = ComposerReturn.sends(
                                    isReturnKey = event.key == Key.Enter || event.key == Key.NumPadEnter,
                                    keyDown = event.type == KeyEventType.KeyDown,
                                    shift = event.isShiftPressed,
                                    fromSoftwareKeyboard =
                                        event.nativeKeyEvent.deviceId == KeyCharacterMap.VIRTUAL_KEYBOARD,
                                )
                                if (sends) onSend()
                                sends
                            },
                    )
                }

                TouchTarget(
                    onClick = onToggleDictation,
                    contentDescription = if (dictationListening) {
                        stringResource(R.string.ui_stop_dictation)
                    } else {
                        stringResource(R.string.ui_start_dictation)
                    },
                ) {
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .background(
                                if (dictationListening) {
                                    Color.Red.copy(alpha = 0.2f)
                                } else {
                                    secondaryTint.copy(alpha = 0.12f)
                                },
                                CircleShape,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.ic_mic),
                            contentDescription = null,
                            tint = if (dictationListening) Color.Red else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }

                TouchTarget(onClick = onSend, enabled = canSend) {
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .background(
                                if (canSend) BubbleColor.mine else secondaryTint.copy(alpha = 0.18f),
                                CircleShape,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Send,
                            contentDescription = stringResource(R.string.ui_send),
                            tint = if (canSend) BubbleColor.mineText else secondaryTint,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }
}
