// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

// A revoked credential cannot be treated as an ordinary empty workspace.
enum class OnboardingPairingState {
    UNPAIRED,
    PAIRED,
    REVOKED,
}

enum class OnboardingRoute {
    WELCOME,
    PAIRING,
    UNPAIRED_HOME,
    NOTIFICATION_PROMPT,
    CHATS,
    REVOKED,
}

enum class NotificationAuthorizationState {
    UNRESOLVED,
    NOT_DETERMINED,
    DETERMINED,
}

/**
 * Durable preference names shared by the pairing commit and the root router.
 *
 * The pending marker is deliberately separate from the benign "already saw
 * this" preference: a new pairing may finish before the app knows the current
 * notification authorization, and the two answers are not the same question.
 *
 * None of these is a secret and none may become a place where anything else
 * rides along (§6): the store that holds them accepts booleans and nothing
 * else, and `OnboardingPreferencesContractTest` in `:app` holds it to that.
 */
object OnboardingPreferenceKeys {
    const val PENDING_NOTIFICATION_ONBOARDING = "companion.onboarding.notificationPending"
    const val WELCOME_SEEN = "companion.onboarding.welcomeSeen"
    const val NOTIFICATION_PROMPT_SEEN = "companion.onboarding.notificationsSeen"

    val ALL: Set<String> = setOf(
        PENDING_NOTIFICATION_ONBOARDING,
        WELCOME_SEEN,
        NOTIFICATION_PROMPT_SEEN,
    )
}

object PairingCommitSequence {
    suspend fun persist(
        markNotificationOnboardingPending: suspend () -> Unit,
        saveConnection: suspend () -> Unit,
    ) {
        markNotificationOnboardingPending()
        saveConnection()
    }
}

object NotificationOnboardingPolicy {
    fun shouldKeepPending(
        isPending: Boolean,
        hasCompletedStep: Boolean,
        authorization: NotificationAuthorizationState,
    ): Boolean {
        if (!isPending) return false
        if (authorization == NotificationAuthorizationState.UNRESOLVED) return true
        return authorization == NotificationAuthorizationState.NOT_DETERMINED && !hasCompletedStep
    }
}

data class OnboardingContext(
    val pairingState: OnboardingPairingState,
    val hasSeenWelcome: Boolean,
    val pairingRequested: Boolean = false,
    val hasPendingPairingInvite: Boolean = false,
    val notificationOnboardingPending: Boolean = false,
    val hasSeenNotificationPrompt: Boolean = false,
    val notificationAuthorization: NotificationAuthorizationState =
        NotificationAuthorizationState.NOT_DETERMINED,
)

object OnboardingRouter {
    fun route(context: OnboardingContext): OnboardingRoute = when (context.pairingState) {
        // First, and unconditionally. A revoked token with a pending invite and
        // a requested pairing is still a revoked token: recovery outranks every
        // other reason this screen could be shown.
        OnboardingPairingState.REVOKED -> OnboardingRoute.REVOKED

        OnboardingPairingState.PAIRED ->
            if (context.pairingRequested || context.hasPendingPairingInvite) {
                OnboardingRoute.PAIRING
            } else if (context.notificationOnboardingPending &&
                !context.hasSeenNotificationPrompt &&
                context.notificationAuthorization == NotificationAuthorizationState.NOT_DETERMINED
            ) {
                OnboardingRoute.NOTIFICATION_PROMPT
            } else {
                OnboardingRoute.CHATS
            }

        OnboardingPairingState.UNPAIRED ->
            if (context.pairingRequested || context.hasPendingPairingInvite) {
                OnboardingRoute.PAIRING
            } else if (context.hasSeenWelcome) {
                OnboardingRoute.UNPAIRED_HOME
            } else {
                OnboardingRoute.WELCOME
            }
    }
}
