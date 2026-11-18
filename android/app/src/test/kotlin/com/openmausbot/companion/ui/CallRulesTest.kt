// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ConfigFlag
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.ToolActivity
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CallRulesTest {
    @Test
    fun `structured questions are announced as questions even when they name a tool`() {
        val question = card("question", "request", "AskUserQuestion")
        val pending = question.copy(card = question.card!!.copy(requestType = "question"))
        assertEquals(CallAction.Announce("Scout has a question. Open the chat to answer it."), react(pendingCard = pending))
    }

    @Test
    fun `refused playback recovers the current call using its latest busy state`() = runTest {
        var active = true
        val refused = CallRules.playSpeech(isCurrent = { active }) { false }
        assertEquals(CallSpeechResult.CURRENT, refused)
        assertEquals(CallAction.Listen, CallRules.speechFinishedAction(refused, busy = false))
        assertEquals(CallAction.StopListeningAndWork, CallRules.speechFinishedAction(refused, busy = true))
        val replaced = CallRules.playSpeech(isCurrent = { active }) { active = false; false }
        assertEquals(CallSpeechResult.OBSOLETE, replaced)
        assertEquals(CallAction.None, CallRules.speechFinishedAction(replaced, busy = false))
        var played = false
        assertEquals(CallSpeechResult.OBSOLETE, CallRules.playSpeech(isCurrent = { active }) { played = true; true })
        assertFalse(played)
    }

    @Test
    fun `failed sends resume only the active idle half duplex call`() {
        assertEquals(CallAction.Listen, CallRules.failedSendAction(active = true, busy = false, speaking = false))
        assertEquals(CallAction.StopListeningAndWork, CallRules.failedSendAction(active = true, busy = true, speaking = false))
        assertEquals(CallAction.None, CallRules.failedSendAction(active = false, busy = false, speaking = false))
        assertEquals(CallAction.None, CallRules.failedSendAction(active = true, busy = false, speaking = true))
    }

    @Test
    fun `a call keeps its original task while the desktop selects another one`() {
        val original = com.openmausbot.companion.core.Bot(
            id = "bot", threadId = "a", name = "Fixture", title = "", description = "", notifications = true,
            color = "blue", unread = false, createdAt = 1.0,
            modelSelection = com.openmausbot.companion.core.ModelSelection("fake", "fake"),
            tasks = listOf(
                com.openmausbot.companion.core.BotTask(threadId = "a", title = "A", createdAt = 1.0),
                com.openmausbot.companion.core.BotTask(threadId = "b", title = "B", createdAt = 2.0),
            ),
        )
        val live = original.copy(threadId = "b", name = "Updated")
        val state = com.openmausbot.companion.core.CompanionState(bots = listOf(live))
        assertEquals("a", CallRules.botForCall(state, original)?.threadId)
        assertEquals("Updated", CallRules.botForCall(state, original)?.name)
        assertNull(CallRules.botForCall(state.copy(bots = listOf(live.copy(id = "other"))), original))
        assertNull(CallRules.botForCall(state.copy(bots = emptyList()), original))
    }

    @Test
    fun `failed sending recovers when concurrent playback finishes`() {
        assertEquals(CallAction.None, react(phase = CallPhase.SENDING, speakerSpeaking = true))
        assertEquals(CallAction.Listen, react(phase = CallPhase.SENDING, speakerSpeaking = false))
    }

    private fun text(id: String, role: Message.Role = Message.Role.BOT, body: String = "Done.") =
        Message(id = id, role = role, kind = Message.Kind.TEXT, at = 1.0, text = body)

    private fun chip(id: String, spoken: String?) =
        Message(id = id, role = Message.Role.BOT, kind = Message.Kind.ACTIVITY, at = 1.0, tool = ToolActivity("read", spoken = spoken))

    private fun card(id: String, requestId: String, tool: String?) =
        Message(id = id, role = Message.Role.BOT, kind = Message.Kind.OPTIONS, at = 1.0, card = OptionCard("Allow?", "", listOf("Allow", "Deny"), requestId = requestId, tool = tool))

    private fun react(
        fresh: List<Message> = emptyList(),
        pendingCard: Message? = null,
        announced: Set<String> = emptySet(),
        phase: CallPhase = CallPhase.WORKING,
        busy: Boolean = false,
        speakerSpeaking: Boolean = false,
    ) = CallRules.react("Scout", fresh, pendingCard, announced, phase, busy, speakerSpeaking)

    @Test
    fun `a pending card is announced once, and never over the bot's own voice`() {
        val permission = card("m1", "req-1", tool = "bash")
        assertEquals(
            CallAction.Announce("Scout is asking for permission. Open the chat to answer it."),
            react(pendingCard = permission, phase = CallPhase.LISTENING),
        )
        assertEquals(
            CallAction.Announce("Scout has a question. Open the chat to answer it."),
            react(pendingCard = card("m2", "req-2", tool = null), phase = CallPhase.WORKING),
        )
        assertEquals(CallAction.None, react(pendingCard = permission, announced = setOf("req-1"), phase = CallPhase.LISTENING))
        assertEquals(CallAction.None, react(pendingCard = permission, phase = CallPhase.SPEAKING))
    }

    @Test
    fun `a reply is read, the newest one, and never the person's own words`() {
        assertEquals(CallAction.SayReply("Second."), react(fresh = listOf(text("a", body = "First."), text("b", body = "Second."))))
        assertEquals(CallAction.None, react(fresh = listOf(text("u", role = Message.Role.USER, body = "hi")), busy = false, phase = CallPhase.LISTENING))
        assertEquals(CallAction.Listen, react(fresh = listOf(text("e", body = "   ")), phase = CallPhase.WORKING))
    }

    @Test
    fun `a spoken chip is narrated only while waiting`() {
        assertEquals(CallAction.SayChip("Reading the logs"), react(fresh = listOf(chip("c", "Reading the logs")), phase = CallPhase.WORKING, busy = true))
        assertEquals(CallAction.None, react(fresh = listOf(chip("c", null)), phase = CallPhase.WORKING, busy = true))
        assertEquals(CallAction.StopListeningAndWork, react(fresh = listOf(chip("c", "Reading")), phase = CallPhase.LISTENING, busy = true))
    }

    @Test
    fun `busy closes the microphone, idle reopens it once the speaker is quiet`() {
        assertEquals(CallAction.StopListeningAndWork, react(phase = CallPhase.LISTENING, busy = true))
        assertEquals(CallAction.StopListeningAndWork, react(phase = CallPhase.SENDING, busy = true))
        assertEquals(CallAction.None, react(phase = CallPhase.WORKING, busy = true))
        assertEquals(CallAction.Listen, react(phase = CallPhase.WORKING, busy = false))
        assertEquals(CallAction.Listen, react(phase = CallPhase.SENDING, busy = false))
        assertEquals(CallAction.None, react(phase = CallPhase.WORKING, busy = false, speakerSpeaking = true))
        assertEquals(CallAction.None, react(phase = CallPhase.LISTENING, busy = false))
    }

    @Test
    fun `the phase line and the notes read as the Swift's`() {
        assertEquals("Listening…", CallRules.phaseText(CallPhase.LISTENING, "Scout"))
        assertEquals("Scout is working…", CallRules.phaseText(CallPhase.WORKING, "Scout"))
        assertEquals("Set up a voice in Settings → Voice to hear Scout.", CallRules.noVoiceNote("Scout"))
        assertEquals(850L, CallRules.ENDPOINT_GAP_MILLIS)
    }

    @Test
    fun `voice settings offer the key only under ElevenLabs`() {
        val ready = ConfigStatus(tts = ConfigFlag(configured = true))
        val system = ConfigStatus(tts = ConfigFlag(configured = true, provider = "system"))
        assertEquals("Ready", VoiceSettingsRules.statusText(ready))
        assertEquals("Not set up", VoiceSettingsRules.statusText(ConfigStatus(tts = ConfigFlag(configured = false))))
        assertNull(VoiceSettingsRules.statusText(null))
        assertTrue(VoiceSettingsRules.showsKeyField(ready))
        assertTrue(VoiceSettingsRules.showsKeyField(null))
        assertFalse(VoiceSettingsRules.showsKeyField(system))
        assertEquals("Replace key", VoiceSettingsRules.saveLabel(ready))
        assertEquals("Save key", VoiceSettingsRules.saveLabel(null))
        assertTrue(VoiceSettingsRules.canSave("sk", saving = false))
        assertFalse(VoiceSettingsRules.canSave("  ", saving = false))
        assertFalse(VoiceSettingsRules.canSave("sk", saving = true))
        assertTrue(VoiceSettingsRules.canRemove(ready, saving = false))
        assertFalse(VoiceSettingsRules.canRemove(null, saving = false))
    }
}
