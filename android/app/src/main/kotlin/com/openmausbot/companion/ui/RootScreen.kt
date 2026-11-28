// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.NotificationAuthorizationState
import com.openmausbot.companion.core.NotificationOnboardingPolicy
import com.openmausbot.companion.core.NotificationTarget
import com.openmausbot.companion.core.OnboardingContext
import com.openmausbot.companion.core.OnboardingPairingState
import com.openmausbot.companion.core.OnboardingRoute
import com.openmausbot.companion.core.OnboardingRouter
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.launch

@Composable
fun CompanionRoot(
    pendingNotification: NotificationTarget?,
    onPendingTargetConsumed: (NotificationTarget) -> Unit,
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val onboarding = environment.onboarding
    val scope = rememberCoroutineScope()

    val status by session.status.collectAsState()
    val connection by session.connection.collectAsState()
    val connections by session.connections.collectAsState()
    val pairingRequested by session.pairingRequested.collectAsState()
    val invite by session.pairingInvite.collectAsState()
    val restoreState by session.restoreState.collectAsState()
    val notificationAccess by environment.notifications.access.collectAsState()
    val welcomeSeen by onboarding.welcomeSeen.collectAsState()
    val notificationPromptSeen by onboarding.notificationPromptSeen.collectAsState()
    val notificationPending by onboarding.notificationPending.collectAsState()

    var showingUnpairedSettings by rememberSaveable { mutableStateOf(false) }
    var enablingNotifications by remember { mutableStateOf(false) }

    val authorization = notificationAuthorization(notificationAccess)
    val route = OnboardingRouter.route(
        OnboardingContext(
            pairingState = onboardingPairingState(status, connection),
            hasSeenWelcome = welcomeSeen,
            pairingRequested = pairingRequested,
            hasPendingPairingInvite = invite != null,
            notificationOnboardingPending = notificationPending,
            hasSeenNotificationPrompt = notificationPromptSeen,
            notificationAuthorization = authorization,
        ),
    )

    fun reconcileNotificationOnboarding() {
        scope.launch {
            onboarding.setNotificationOnboardingPending(
                NotificationOnboardingPolicy.shouldKeepPending(
                    isPending = onboarding.notificationPending.value,
                    hasCompletedStep = onboarding.notificationPromptSeen.value,
                    authorization = authorization,
                ),
            )
        }
    }

    fun startPairing() {
        scope.launch { onboarding.setWelcomeSeen(true) }
        session.beginPairing()
    }

    fun finishNotificationStep() {
        scope.launch { onboarding.setNotificationPromptSeen(true) }
    }

    BackHandler(enabled = showingUnpairedSettings) { showingUnpairedSettings = false }
    LaunchedEffect(route) {
        if (route != OnboardingRoute.UNPAIRED_HOME) showingUnpairedSettings = false
    }

    LaunchedEffect(connection != null) {
        if (connection == null) return@LaunchedEffect
        onboarding.setWelcomeSeen(true)
    }
    LaunchedEffect(authorization, notificationPromptSeen, notificationPending) {
        reconcileNotificationOnboarding()
    }

    val tapCoordinator = remember { NotificationTapCoordinator() }
    val resolution by tapCoordinator.resolution.collectAsState()
    var bondGeneration by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(status) {
        if (NotificationTapCoordinator.leavesBond(status)) {
            tapCoordinator.discardResolved()
            bondGeneration += 1
        }
    }
    val otherComputer = pendingNotification?.let { target ->
        connections.firstOrNull { it.id == target.connectionId && it.id != connection?.id }
    }
    LaunchedEffect(pendingNotification, connection?.id, otherComputer?.id, status, restoreState) {
        if (otherComputer != null) return@LaunchedEffect
        val target = pendingNotification ?: return@LaunchedEffect
        tapCoordinator.onPending(session, target, onPendingTargetConsumed)
    }

    CompanionTheme {
        if (otherComputer != null && pendingNotification != null) {
            AlertDialog(
                onDismissRequest = { onPendingTargetConsumed(pendingNotification) },
                title = { Text(stringResource(R.string.notification_other_computer)) },
                confirmButton = {
                    TextButton(onClick = { session.switchComputer(otherComputer.id) }) { Text(otherComputer.name) }
                },
                dismissButton = {
                    TextButton(onClick = { onPendingTargetConsumed(pendingNotification) }) { Text(stringResource(R.string.ui_cancel)) }
                },
            )
        }
        Box(modifier = Modifier.fillMaxSize()) {
            Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                Box(modifier = Modifier.fillMaxSize()) {
                    when (route) {
                        OnboardingRoute.WELCOME -> WelcomeScreen(
                            onConnect = ::startPairing,
                            onSkip = {
                                scope.launch { onboarding.setWelcomeSeen(true) }
                                session.endPairing()
                            },
                        )

                        OnboardingRoute.PAIRING -> {
                            LaunchedEffect(Unit) {
                                onboarding.setWelcomeSeen(true)
                                session.beginPairing()
                            }
                            PairingScreen(
                                onCancel = {
                                    scope.launch { onboarding.setWelcomeSeen(true) }
                                    session.endPairing()
                                },
                            )
                        }

                        OnboardingRoute.UNPAIRED_HOME -> if (showingUnpairedSettings) {
                            SettingsScreen(
                                onBack = { showingUnpairedSettings = false },
                                onConnect = {
                                    showingUnpairedSettings = false
                                    startPairing()
                                },
                            )
                        } else {
                            UnpairedHomeScreen(
                                onConnect = ::startPairing,
                                onOpenSettings = { showingUnpairedSettings = true },
                            )
                        }

                        OnboardingRoute.NOTIFICATION_PROMPT -> {
                            NotificationOnboardingScreen(
                                enabling = enablingNotifications,
                                onEnable = {
                                    enablingNotifications = true
                                    scope.launch {
                                        onboarding.setNotificationPromptSeen(true)
                                        environment.notifications.act()
                                        enablingNotifications = false
                                    }
                                },
                                onSkip = ::finishNotificationStep,
                            )
                        }

                        OnboardingRoute.CHATS -> {
                            PairedScreen(
                                resolution = resolution,
                                bondGeneration = bondGeneration,
                                onCommit = { held, navigator ->
                                    tapCoordinator.commit(held, navigator, session.connection.value?.id, onPendingTargetConsumed)
                                },
                            )
                        }

                        OnboardingRoute.REVOKED -> if (connection?.serverEnvironmentId?.startsWith("startupbot-mobile:") == true) {
                            EmptyState(title = stringResource(R.string.mobile_sign_in_again), description = "") {
                                MobileChatButton()
                                connections.filter { it.id != connection?.id }.forEach { other ->
                                    TextButton(onClick = { session.switchComputer(other.id) }) { Text(other.name) }
                                }
                                TextButton(onClick = { session.signOut(); startPairing() }) { Text(stringResource(R.string.ui_onboardingcopy_welcome_connect)) }
                            }
                        } else UnpairedScreen(
                            onPairAgain = {
                                session.signOut()
                                startPairing()
                            },
                            onChooseAnother = connections.firstOrNull { it.id != connection?.id }
                                ?.let { other -> { session.switchComputer(other.id) } },
                        )
                    }
                    val pendingShare by environment.shareInbox.pending.collectAsState()
                    pendingShare?.let { share ->
                        ShareSheet(pending = share, onDismiss = environment.shareInbox::consume)
                    }
                }
            }
            if (route != OnboardingRoute.PAIRING) {
                ActionErrorDialog(session)
            }
        }
    }
}

// A revoked credential cannot be treated as an ordinary empty workspace.
internal fun onboardingPairingState(
    status: Session.Status,
    connection: Connection?,
): OnboardingPairingState = when {
    status is Session.Status.Unauthorized -> OnboardingPairingState.REVOKED
    connection != null -> OnboardingPairingState.PAIRED
    else -> OnboardingPairingState.UNPAIRED
}


internal fun notificationAuthorization(
    access: NotificationAccess,
): NotificationAuthorizationState = when (access) {
    NotificationAccess.ASKABLE -> NotificationAuthorizationState.NOT_DETERMINED
    NotificationAccess.GRANTED, NotificationAccess.BLOCKED ->
        NotificationAuthorizationState.DETERMINED
}

@Composable
private fun PairedScreen(
    resolution: NotificationTapCoordinator.Resolution?,
    bondGeneration: Int,
    onCommit: (NotificationTapCoordinator.Resolution, CompanionNavigator) -> Unit,
) {
    val navigator = rememberCompanionNavigator(bondGeneration)

    LaunchedEffect(resolution?.generation) {
        val held = resolution ?: return@LaunchedEffect
        onCommit(held, navigator)
    }

    BackHandler(enabled = navigator.canGoBack) { navigator.pop() }

    when (val destination = navigator.current) {
        Destination.Roster -> RosterScreen(navigator)
        Destination.Settings -> SettingsScreen(
            onBack = navigator::pop,
            onOpenRoutines = { navigator.push(Destination.Routines) },
            onOpenConnectedApps = { navigator.push(Destination.ConnectedApps) },
            onOpenVoice = { navigator.push(Destination.Voice) },
        )
        Destination.Routines -> TasksRoutinesScreen(
            onBack = navigator::pop,
            onOpenChat = navigator::open,
        )
        Destination.ConnectedApps -> ConnectedAppsScreen(onBack = navigator::pop)
        Destination.Voice -> VoiceSettingsScreen(onBack = navigator::pop)
        is Destination.Conversation -> ChatScreen(
            destination = destination,
            onResolved = { target ->
                navigator.selectTask(destination, target)
            },
            onBack = navigator::pop,
            onOpenComputer = { navigator.push(Destination.Computer(it)) },
            onOpenOverview = { navigator.push(Destination.Overview(it)) },
            retainsDraft = navigator::retainsChatDraft,
            onOpenChat = navigator::open,
        )
        is Destination.Computer -> ComputerScreen(
            botId = destination.botId,
            onBack = navigator::pop,
        )
        is Destination.Overview -> BotOverviewScreen(
            botId = destination.botId,
            onBack = navigator::pop,
        )
    }
}

@Composable
private fun ActionErrorDialog(session: Session) {
    val message by session.actionErrorFlow.collectAsState()
    val text = message ?: return
    AlertDialog(
        onDismissRequest = { session.actionError = null },
        title = { Text(stringResource(R.string.ui_something_went_wrong)) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = { session.actionError = null }) { Text("OK") }
        },
    )
}

/**
 * The token stopped working. Almost always because someone revoked this phone on
 * the computer — which is exactly what that button is for, so the honest thing is
 * to say so and offer to pair again.
 */
@Composable
private fun UnpairedScreen(onPairAgain: () -> Unit, onChooseAnother: (() -> Unit)? = null) {
    EmptyState(
        title = stringResource(R.string.ui_this_phone_was_unpaired),
        description = stringResource(R.string.ui_it_was_removed_from_the_computer_s_phone_settings_or_the_pairing),
    ) {
        Button(onClick = onPairAgain) { Text(stringResource(R.string.ui_pair_again)) }
        onChooseAnother?.let { choose ->
            TextButton(onClick = choose) { Text(stringResource(R.string.ui_use_another_computer)) }
        }
    }
}

@Composable
fun EmptyState(
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodyMedium,
            color = secondaryTint,
            textAlign = TextAlign.Center,
        )
        actions()
    }
}
