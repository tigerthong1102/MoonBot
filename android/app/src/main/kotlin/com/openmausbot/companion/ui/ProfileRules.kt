// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.AvatarCrop
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotProfilePatch
import com.openmausbot.companion.core.ConfigStatus
import com.openmausbot.companion.core.Voice
import com.openmausbot.companion.core.VoiceProvider

data class ProfileForm(
    val name: String,
    val title: String,
    val description: String,
    val notifications: Boolean,
    val crop: AvatarCrop,
    val voice: String,
    val speakReplies: Boolean,
) {
    companion object {
        fun of(bot: Bot): ProfileForm = ProfileForm(
            name = bot.name,
            title = bot.title,
            description = bot.description,
            notifications = bot.notifications,
            crop = bot.avatarCrop ?: AvatarCrop.MASCOT,
            voice = bot.voice ?: "",
            speakReplies = bot.speakReplies == true,
        )
    }
}

data class VoiceChoice(
    val id: String,
    val label: String,
    val detail: String?,
    val enabled: Boolean,
)

object ProfileRules {
    const val GENERATE_PROMPT_LIMIT: Int = 400


    const val AVATAR_FOOTER: String =
        "PNG, JPEG, GIF, or WebP, up to 10 MB. Images are stored on your paired computer " +
            "and loaded with this phone's pairing token."

    private const val GENERATE_READY_FOOTER: String =
        "Generation uses the shared image provider configured on your computer. No provider " +
            "key is sent to or stored on this phone."

    private const val GENERATE_BLOCKED_FOOTER: String =
        "To generate images, configure the shared image provider in StartupBot on your " +
            "computer. Provider keys cannot be added from a phone."

    // The ElevenLabs copy below is what iOS ships and is correct under that
    // engine, so it stays byte-identical. Each string that names the engine or
    // its credential has a built-in-provider twin, because under `provider:
    // "system"` there is no key and "not configured" means something else
    // entirely. The desktop is called "the computer" throughout, the way the
    // rest of this file already does.

    private const val TTS_UNCONFIGURED: String = "ElevenLabs is not configured"

    private const val SYSTEM_TTS_UNCONFIGURED: String = "Your computer's built-in voices are unavailable"

    private const val VOICE_UNCONFIGURED_FOOTER: String =
        "Add the shared ElevenLabs key in this agent's profile on the computer. The key is " +
            "never returned to this phone."

    /**
     * The built-in engine's remedy is a different engine, not a credential.
     * Telling the user to add a key here would name a fix that changes
     * nothing; the computer's voice settings are where the engine is chosen,
     * and that control stays reachable in exactly this state.
     */
    private const val SYSTEM_VOICE_UNCONFIGURED_FOOTER: String =
        "Your computer's built-in voices need no key, and it reports none it can use. Switch " +
            "the voice engine in StartupBot on the computer to turn speech back on."

    private const val VOICE_NO_DEFAULT_FOOTER: String =
        "No workspace default voice is selected. Choose an agent-specific voice above; " +
            "synthesis still uses the shared ElevenLabs key on your computer."

    private const val FISH_TTS_UNCONFIGURED: String = "Fish Audio is not configured"

    private const val FISH_VOICE_UNCONFIGURED_FOOTER: String =
        "Add the shared Fish Audio API key in StartupBot on the computer. The key is " +
            "never returned to this phone."

    private const val FISH_VOICE_NO_DEFAULT_FOOTER: String =
        "No workspace default voice is selected. Choose an agent-specific voice above; " +
            "synthesis still uses Fish Audio on your computer."

    private const val SYSTEM_VOICE_NO_DEFAULT_FOOTER: String =
        "No workspace default voice is selected. Choose an agent-specific voice above; " +
            "synthesis still uses your computer's built-in voices."

    // Chatterbox's credential is a local server address, which is a setting
    // this form deliberately leaves on the computer: the picker can choose the
    // engine, but only the computer can point it at a server.
    private const val CHATTERBOX_TTS_UNCONFIGURED: String = "The Chatterbox server is not connected"

    private const val CHATTERBOX_VOICE_UNCONFIGURED_FOOTER: String =
        "Add the address of your Chatterbox server in StartupBot on the computer to turn " +
            "speech back on."

    private const val CHATTERBOX_VOICE_NO_DEFAULT_FOOTER: String =
        "No workspace default voice is selected. Choose an agent-specific voice above; " +
            "synthesis still uses your Chatterbox server."

    // The two below name no engine and no credential. They are true word for
    // word under both providers, so they have no twin to choose between — and
    // that is exactly why they stay public: there is no wrong arm to draw.

    private const val VOICE_READY_FOOTER: String =
        "The voice choice belongs to this agent. Workspace default uses the shared voice " +
            "selected on your computer."

    private const val PICK_A_VOICE: String =
        "Pick a voice for this agent before enabling speech."

    const val PREVIEW_REFUSED: String =
        "Pick an agent voice or configure a workspace default on your computer first."

    fun patch(form: ProfileForm, baseline: ProfileForm, config: ConfigStatus?): BotProfilePatch {
        val savedSpeakReplies = config
            ?.let { it.canSpeak(form.voice) && form.speakReplies }
            ?: form.speakReplies
        return BotProfilePatch(
            name = if (form.name == baseline.name) null else form.name.trim(),
            title = if (form.title == baseline.title) null else form.title.trim(),
            description = if (form.description == baseline.description) {
                null
            } else {
                form.description.trim()
            },
            notifications = if (form.notifications == baseline.notifications) {
                null
            } else {
                form.notifications
            },
            avatarCrop = if (form.crop == baseline.crop) null else form.crop,
            voice = if (form.voice == baseline.voice) null else form.voice,
            speakReplies = if (savedSpeakReplies == baseline.speakReplies) {
                null
            } else {
                savedSpeakReplies
            },
        )
    }

    fun canSave(form: ProfileForm, busy: Boolean): Boolean =
        !busy && form.name.trim().isNotEmpty()

    fun imageGenerationReady(config: ConfigStatus?): Boolean = config?.imageGen?.configured == true

    fun canGenerate(busy: Boolean, config: ConfigStatus?, prompt: String): Boolean =
        !busy && imageGenerationReady(config) && prompt.trim().isNotEmpty()

    fun generatePrompt(raw: String): String = raw.trim().take(GENERATE_PROMPT_LIMIT)

    fun generateFooter(config: ConfigStatus?): String =
        if (imageGenerationReady(config)) GENERATE_READY_FOOTER else GENERATE_BLOCKED_FOOTER

    fun selectedVoiceCanSpeak(config: ConfigStatus?, voice: String): Boolean =
        config?.canSpeak(voice) == true

    fun canPreview(busy: Boolean, config: ConfigStatus?, voice: String): Boolean =
        !busy && selectedVoiceCanSpeak(config, voice)

    fun voiceConfigured(config: ConfigStatus?): Boolean = config?.isTTSConfigured == true

    private fun provider(config: ConfigStatus?): VoiceProvider =
        config?.voiceProvider ?: VoiceProvider.ELEVENLABS

    private fun ttsUnconfiguredLabel(config: ConfigStatus?): String = when (provider(config)) {
        VoiceProvider.ELEVENLABS -> TTS_UNCONFIGURED
        VoiceProvider.FISH -> FISH_TTS_UNCONFIGURED
        VoiceProvider.SYSTEM -> SYSTEM_TTS_UNCONFIGURED
        VoiceProvider.CHATTERBOX -> CHATTERBOX_TTS_UNCONFIGURED
    }

    private fun voiceFooter(config: ConfigStatus?): String = when {
        !voiceConfigured(config) -> when (provider(config)) {
            VoiceProvider.ELEVENLABS -> VOICE_UNCONFIGURED_FOOTER
            VoiceProvider.FISH -> FISH_VOICE_UNCONFIGURED_FOOTER
            VoiceProvider.SYSTEM -> SYSTEM_VOICE_UNCONFIGURED_FOOTER
            VoiceProvider.CHATTERBOX -> CHATTERBOX_VOICE_UNCONFIGURED_FOOTER
        }
        config?.hasWorkspaceDefaultVoice != true -> when (provider(config)) {
            VoiceProvider.ELEVENLABS -> VOICE_NO_DEFAULT_FOOTER
            VoiceProvider.FISH -> FISH_VOICE_NO_DEFAULT_FOOTER
            VoiceProvider.SYSTEM -> SYSTEM_VOICE_NO_DEFAULT_FOOTER
            VoiceProvider.CHATTERBOX -> CHATTERBOX_VOICE_NO_DEFAULT_FOOTER
        }
        else -> VOICE_READY_FOOTER
    }

    data class VoiceCopy(
        val footer: String,
        val unconfiguredNotice: String?,
    )

    fun voiceCopy(config: ConfigStatus?): VoiceCopy = VoiceCopy(
        footer = voiceFooter(config),
        unconfiguredNotice = if (voiceConfigured(config)) null else ttsUnconfiguredLabel(config),
    )

    fun pickAVoiceHint(config: ConfigStatus?, voice: String): String? =
        if (config?.hasWorkspaceDefaultVoice != true && voice.isEmpty()) PICK_A_VOICE else null

    fun voiceChoices(config: ConfigStatus?, voices: List<Voice>, voice: String): List<VoiceChoice> {
        val out = mutableListOf<VoiceChoice>()
        out += if (config?.hasWorkspaceDefaultVoice == true) {
            VoiceChoice(id = "", label = "Workspace default", detail = null, enabled = true)
        } else {
            VoiceChoice(id = "", label = "Choose an agent voice", detail = null, enabled = false)
        }
        if (voice.isNotEmpty() && voices.none { it.id == voice }) {
            out += VoiceChoice(id = voice, label = "Current agent voice", detail = null, enabled = true)
        }
        voices.forEach { out += VoiceChoice(id = it.id, label = it.label, detail = it.description, enabled = true) }
        return out
    }

    fun providerChoices(): List<VoiceChoice> = listOf(
        VoiceChoice(VoiceProvider.ELEVENLABS.wire, "ElevenLabs", null, enabled = true),
        VoiceChoice(VoiceProvider.FISH.wire, "Fish Audio", null, enabled = true),
        VoiceChoice(VoiceProvider.SYSTEM.wire, "Built-in Mac voices", null, enabled = true),
        VoiceChoice(VoiceProvider.CHATTERBOX.wire, "Chatterbox (local)", null, enabled = true),
    )

    fun applyLoadedConfig(form: ProfileForm, config: ConfigStatus?): ProfileForm =
        if (config != null && !config.canSpeak(form.voice)) form.copy(speakReplies = false) else form

    fun afterVoiceProviderSwitch(
        form: ProfileForm,
        baseline: ProfileForm,
        config: ConfigStatus,
    ): Pair<ProfileForm, ProfileForm> {
        val cleared = applyLoadedConfig(form.copy(voice = ""), config)
        return cleared to baseline.copy(voice = "")
    }

    fun cropLabel(crop: AvatarCrop): String = when (crop) {
        AvatarCrop.MASCOT -> "Mascot"
        AvatarCrop.CIRCLE -> "Circle"
        AvatarCrop.ROUNDED -> "Rounded"
        AvatarCrop.SQUARE -> "Square"
    }
}
