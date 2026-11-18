// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.storage

import android.content.Context
import android.content.SharedPreferences
import com.openmausbot.companion.core.OnboardingPreferenceKeys
import com.openmausbot.companion.core.OnboardingStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

// Onboarding markers cannot contain credentials and are excluded from backup.
// SharedPreferences.commit() completes the durable write synchronously.
class OnboardingPreferences(
    private val prefs: SharedPreferences,
    private val io: kotlin.coroutines.CoroutineContext = Dispatchers.IO,
) : OnboardingStore {

    constructor(context: Context) : this(
        context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE),
    )

    private val _welcomeSeen = MutableStateFlow(read(OnboardingPreferenceKeys.WELCOME_SEEN))
    private val _notificationPromptSeen =
        MutableStateFlow(read(OnboardingPreferenceKeys.NOTIFICATION_PROMPT_SEEN))
    private val _notificationPending =
        MutableStateFlow(read(OnboardingPreferenceKeys.PENDING_NOTIFICATION_ONBOARDING))

    val welcomeSeen: StateFlow<Boolean> = _welcomeSeen.asStateFlow()

    val notificationPromptSeen: StateFlow<Boolean> = _notificationPromptSeen.asStateFlow()

    val notificationPending: StateFlow<Boolean> = _notificationPending.asStateFlow()

    override suspend fun notificationOnboardingPending(): Boolean = _notificationPending.value

    override suspend fun setNotificationOnboardingPending(pending: Boolean) {
        write(OnboardingPreferenceKeys.PENDING_NOTIFICATION_ONBOARDING, pending, _notificationPending)
    }

    suspend fun setWelcomeSeen(seen: Boolean) {
        write(OnboardingPreferenceKeys.WELCOME_SEEN, seen, _welcomeSeen)
    }

    suspend fun setNotificationPromptSeen(seen: Boolean) {
        write(OnboardingPreferenceKeys.NOTIFICATION_PROMPT_SEEN, seen, _notificationPromptSeen)
    }

    private fun read(key: String): Boolean = prefs.getBoolean(key, false)

    private suspend fun write(key: String, value: Boolean, into: MutableStateFlow<Boolean>) {
        if (into.value == value && prefs.contains(key)) return
        withContext(io) { prefs.edit().putBoolean(key, value).commit() }
        into.value = value
    }

    companion object {
        const val NAME = "openmaus.onboarding"

        const val FILE = "$NAME.xml"
    }
}
