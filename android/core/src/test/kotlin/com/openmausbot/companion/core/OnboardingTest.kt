// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest


class OnboardingTest {

    private fun route(
        pairingState: OnboardingPairingState,
        hasSeenWelcome: Boolean,
        pairingRequested: Boolean = false,
        hasPendingPairingInvite: Boolean = false,
        notificationOnboardingPending: Boolean = false,
        hasSeenNotificationPrompt: Boolean = false,
        notificationAuthorization: NotificationAuthorizationState =
            NotificationAuthorizationState.NOT_DETERMINED,
    ) = OnboardingRouter.route(
        OnboardingContext(
            pairingState = pairingState,
            hasSeenWelcome = hasSeenWelcome,
            pairingRequested = pairingRequested,
            hasPendingPairingInvite = hasPendingPairingInvite,
            notificationOnboardingPending = notificationOnboardingPending,
            hasSeenNotificationPrompt = hasSeenNotificationPrompt,
            notificationAuthorization = notificationAuthorization,
        ),
    )

    @Test
    fun firstLaunchShowsWelcome() {
        assertEquals(
            OnboardingRoute.WELCOME,
            route(OnboardingPairingState.UNPAIRED, hasSeenWelcome = false),
        )
    }

    @Test
    fun skipShowsUsefulUnpairedHome() {
        assertEquals(
            OnboardingRoute.UNPAIRED_HOME,
            route(OnboardingPairingState.UNPAIRED, hasSeenWelcome = true),
        )
    }

    @Test
    fun resumeAndPendingInviteBothOpenPairing() {
        assertEquals(
            OnboardingRoute.PAIRING,
            route(
                OnboardingPairingState.UNPAIRED,
                hasSeenWelcome = true,
                pairingRequested = true,
            ),
        )
        assertEquals(
            OnboardingRoute.PAIRING,
            route(
                OnboardingPairingState.UNPAIRED,
                hasSeenWelcome = false,
                hasPendingPairingInvite = true,
            ),
        )
    }

    @Test
    fun existingPairedUserGoesStraightToChats() {
        assertEquals(
            OnboardingRoute.CHATS,
            route(OnboardingPairingState.PAIRED, hasSeenWelcome = true),
        )
    }

    @Test
    fun pairedUserCanOpenPairingToAddAnotherComputer() {
        assertEquals(
            OnboardingRoute.PAIRING,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                pairingRequested = true,
            ),
        )
        assertEquals(
            OnboardingRoute.PAIRING,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                hasPendingPairingInvite = true,
            ),
        )
    }

    @Test
    fun justPairedUserSeesNotificationExplanationOnceThenChats() {
        assertEquals(
            OnboardingRoute.NOTIFICATION_PROMPT,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                notificationOnboardingPending = true,
                notificationAuthorization = NotificationAuthorizationState.NOT_DETERMINED,
            ),
        )
        assertEquals(
            OnboardingRoute.CHATS,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                notificationOnboardingPending = true,
                hasSeenNotificationPrompt = true,
            ),
        )
        assertEquals(
            OnboardingRoute.CHATS,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                notificationOnboardingPending = true,
                notificationAuthorization = NotificationAuthorizationState.DETERMINED,
            ),
        )
    }

    @Test
    fun pendingNotificationEducationSurvivesUnresolvedLaunchAndRelaunch() {
        assertEquals(
            OnboardingRoute.CHATS,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                notificationOnboardingPending = true,
                notificationAuthorization = NotificationAuthorizationState.UNRESOLVED,
            ),
            "an unresolved answer is not permission to show the step",
        )
        assertTrue(
            NotificationOnboardingPolicy.shouldKeepPending(
                isPending = true,
                hasCompletedStep = false,
                authorization = NotificationAuthorizationState.UNRESOLVED,
            ),
            "and it is certainly not permission to spend the marker",
        )

        assertEquals(
            OnboardingRoute.NOTIFICATION_PROMPT,
            route(
                OnboardingPairingState.PAIRED,
                hasSeenWelcome = true,
                notificationOnboardingPending = true,
                notificationAuthorization = NotificationAuthorizationState.NOT_DETERMINED,
            ),
        )
        assertTrue(
            NotificationOnboardingPolicy.shouldKeepPending(
                isPending = true,
                hasCompletedStep = false,
                authorization = NotificationAuthorizationState.NOT_DETERMINED,
            ),
        )
    }

    @Test
    fun pairingCommitMarksNotificationStepBeforeSavingConnection() = runTest {
        val writes = mutableListOf<String>()

        PairingCommitSequence.persist(
            markNotificationOnboardingPending = { writes += "notification-pending" },
            saveConnection = { writes += "connection" },
        )

        assertEquals(listOf("notification-pending", "connection"), writes)
    }

    @Test
    fun resolvedOrCompletedNotificationEducationClearsPendingMarker() {
        assertFalse(
            NotificationOnboardingPolicy.shouldKeepPending(
                isPending = true,
                hasCompletedStep = false,
                authorization = NotificationAuthorizationState.DETERMINED,
            ),
        )
        assertFalse(
            NotificationOnboardingPolicy.shouldKeepPending(
                isPending = true,
                hasCompletedStep = true,
                authorization = NotificationAuthorizationState.NOT_DETERMINED,
            ),
        )
        assertTrue(
            NotificationOnboardingPolicy.shouldKeepPending(
                isPending = true,
                hasCompletedStep = true,
                authorization = NotificationAuthorizationState.UNRESOLVED,
            ),
        )
        assertFalse(
            NotificationOnboardingPolicy.shouldKeepPending(
                isPending = false,
                hasCompletedStep = false,
                authorization = NotificationAuthorizationState.UNRESOLVED,
            ),
        )
    }

    @Test
    fun clearedDeferredInviteCannotReopenPairingAfterLaterUnpair() {
        assertEquals(
            OnboardingRoute.PAIRING,
            route(
                OnboardingPairingState.UNPAIRED,
                hasSeenWelcome = true,
                hasPendingPairingInvite = true,
            ),
        )
        assertEquals(
            OnboardingRoute.UNPAIRED_HOME,
            route(
                OnboardingPairingState.UNPAIRED,
                hasSeenWelcome = true,
                hasPendingPairingInvite = false,
            ),
        )
    }

    @Test
    fun revokedPairingAlwaysShowsRecovery() {
        assertEquals(
            OnboardingRoute.REVOKED,
            route(
                OnboardingPairingState.REVOKED,
                hasSeenWelcome = false,
                pairingRequested = true,
                hasPendingPairingInvite = true,
            ),
            "revocation outranks a requested pairing and a pending deep link",
        )
        assertEquals(
            OnboardingRoute.REVOKED,
            route(
                OnboardingPairingState.REVOKED,
                hasSeenWelcome = true,
                notificationOnboardingPending = true,
                notificationAuthorization = NotificationAuthorizationState.NOT_DETERMINED,
            ),
        )
    }

    @Test
    fun everyCombinationOfTheThreeUnpairedInputsIsAccountedFor() {
        val expected = mapOf(
            Triple(false, false, false) to OnboardingRoute.WELCOME,
            Triple(true, false, false) to OnboardingRoute.UNPAIRED_HOME,
            Triple(false, true, false) to OnboardingRoute.PAIRING,
            Triple(true, true, false) to OnboardingRoute.PAIRING,
            Triple(false, false, true) to OnboardingRoute.PAIRING,
            Triple(true, false, true) to OnboardingRoute.PAIRING,
            Triple(false, true, true) to OnboardingRoute.PAIRING,
            Triple(true, true, true) to OnboardingRoute.PAIRING,
        )
        for ((inputs, want) in expected) {
            val (seen, requested, invited) = inputs
            assertEquals(
                want,
                route(
                    OnboardingPairingState.UNPAIRED,
                    hasSeenWelcome = seen,
                    pairingRequested = requested,
                    hasPendingPairingInvite = invited,
                ),
                "welcome=$seen requested=$requested invite=$invited",
            )
        }
    }
}
