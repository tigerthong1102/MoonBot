// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.PairingInvite
import com.openmausbot.companion.core.PairingRouteError
import com.openmausbot.companion.core.ServerPairingRetryError
import com.openmausbot.companion.discovery.DiscoveredService
import com.openmausbot.companion.discovery.DiscoveryState
import com.openmausbot.companion.discovery.toConnection
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun PairingScreen(onCancel: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val secrets = PairingSecrets

    var manualAddress by rememberSaveable { mutableStateOf("") }
    // Saved instance state holds the computer and a handle, never a secret. A
    // rotation keeps the same process, so PairingSecrets still has the scanned
    // credential and the typed digits; a restore after the system killed the app
    // gets an empty store, and the confirm step asks for a rescan rather than
    // replaying a token that may already have been redeemed (§6).
    var pending by rememberSaveable(stateSaver = PendingPairingSaver) {
        mutableStateOf<PendingPairing?>(null)
    }
    LaunchedEffect(pending?.handle) {
        val current = pending ?: return@LaunchedEffect
        val rebound = current.rebindingIfOrphaned(secrets)
        if (rebound !== current) pending = rebound
    }
    var code by remember(pending?.handle) { mutableStateOf(secrets.code(pending?.handle)) }
    // Presentational only: the spinner and the disabled buttons. Whether an
    // attempt is in flight is the secret store's answer, not this flag's —
    // `PairingSecrets` is the one object that can refuse to replace the slot.
    var pairing by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var showingScanner by remember { mutableStateOf(false) }
    var searchedLongEnough by remember { mutableStateOf(false) }
    var showingOtherWays by rememberSaveable { mutableStateOf(false) }

    val permissionSnapshot by environment.permissions.snapshot.collectAsState()

    LaunchedEffect(showingOtherWays) {
        searchedLongEnough = false
        if (!showingOtherWays) return@LaunchedEffect
        // Nearby devices, and on API 37 the local network, are asked for here
        // and nowhere else in the app. This is the first moment the app has any
        // use for them, and the person has just said what that use is.
        val missing = environment.permissions.discoveryPermissions()
        if (missing.isNotEmpty()) environment.requestPermissions(missing)
        delay(8_000)
        searchedLongEnough = true
    }

    // The credential goes to the process-scoped store; only the handle is ever
    // held by composition state, and the handle is minted with the computer it
    // belongs to, so this screen never has two halves to line up.
    fun openPending(connection: Connection, fromScan: Boolean) {
        val opened = PendingPairing.opening(secrets, connection, fromScan) ?: return
        pending = opened
        code = ""
        failure = null
    }

    val invite by session.pairingInvite.collectAsState()
    LaunchedEffect(invite) {
        val accepted = invite ?: return@LaunchedEffect
        val next = secrets.takeInvite(pending, accepted, session::consumePairingInvite)
        if (next !== pending) {
            pending = next
            code = ""
            failure = null
        }
    }

    val actionError by session.actionErrorFlow.collectAsState()
    LaunchedEffect(actionError) {
        val message = actionError ?: return@LaunchedEffect
        failure = message
        session.actionError = null
    }

    val discovery by produceState<DiscoveryState>(DiscoveryState.Idle, showingOtherWays) {
        if (!showingOtherWays) {
            value = DiscoveryState.Idle
            return@produceState
        }
        environment.discovery.discover().collect { value = it }
    }

    if (showingScanner) {
        QrScannerScreen(
            onCancel = { showingScanner = false },
            validate = { payload ->
                if (PairingInvite.parse(payload) == null) {
                    "That isn't an StartupBot pairing QR code."
                } else {
                    // Session decides whether this invite may be accepted at all
                    // (already paired, credential already burned) and publishes
                    // it as `pairingInvite` for the confirm step above.
                    session.receivePairingURL(payload)
                    showingScanner = false
                    null
                }
            },
        )
        return
    }

    fun submit(connection: Connection, credential: String, cameFromScanner: Boolean) {
        val selectedHandle = pending?.handle
        val pairRequestId = secrets.pairRequestId(selectedHandle) ?: return
        // Claims the slot for this redemption. It refuses a second submit, and
        // from here the store will not open a slot for an arriving deep link,
        // so the credential being redeemed cannot be replaced under it.
        if (!secrets.beginAttempt(selectedHandle)) return
        pairing = true
        failure = null
        scope.launch {
            try {
                session.pair(connection, credential, pairRequestId)
                secrets.clear(selectedHandle)
            } catch (error: Throwable) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                failure = session.actionError ?: error.message ?: "Pairing failed."
                session.actionError = null
                when (pairingFailureDisposition(error, cameFromScanner)) {
                    PairingFailureDisposition.RETAIN_ATTEMPT -> {
                        // Neither the credential nor its request id leaves memory: Retry is the
                        // same idempotent logical request, possibly recovering a lost response.
                    }
                    PairingFailureDisposition.DROP_SCANNED_ATTEMPT -> {
                        if (pending?.handle == selectedHandle) pending = null
                        secrets.clear(selectedHandle)
                    }
                    PairingFailureDisposition.RESET_TYPED_ATTEMPT -> {
                        if (pending?.handle == selectedHandle) code = ""
                        secrets.resetAttempt(selectedHandle)
                    }
                }
            } finally {
                val next = secrets.endAttemptTaking(
                    handle = selectedHandle,
                    current = pending,
                    invite = session.pairingInvite.value,
                    consume = session::consumePairingInvite,
                )
                if (next !== pending) {
                    pending = next
                    code = ""
                    failure = null
                }
                pairing = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Pair with a computer",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            // The way back out, which the first run needs and which iOS puts in
            // the same place. Refused while a redemption is in flight, because a
            // credential that may already have reached the computer must not be
            // abandoned halfway (§6) — the port of `.disabled(!allowsNavigation)`.
            TextButton(onClick = onCancel, enabled = !pairing) { Text("Not now") }
        }

        val selected = pending
        if (selected != null) {
            CodeSection(
                confirmation = PairingConfirmation.of(selected, secrets),
                code = code,
                onCodeChange = { value ->
                    val normalized = value.uppercase(java.util.Locale.ROOT)
                        .filter { it in 'A'..'Z' || it in '0'..'9' }.take(12)
                    code = normalized
                    secrets.setCode(selected.handle, normalized)
                },
                pairing = pairing,
                onSubmit = { credential ->
                    haptics.play(HapticCue.SELECT)
                    submit(selected.connection, credential, selected.fromScan)
                },
                onCancel = {
                    haptics.play(HapticCue.SELECT)
                    pending = null
                    code = ""
                    secrets.clear(selected.handle)
                    failure = null
                },
            )
        } else {
            SetupSection(onScan = {
                haptics.play(HapticCue.SELECT)
                failure = null
                showingScanner = true
            })
            OtherWaysSection(
                expanded = showingOtherWays,
                onToggle = {
                    haptics.play(HapticCue.SELECT)
                    showingOtherWays = !showingOtherWays
                },
            ) {
                DiscoverySection(
                    discovery = discovery,
                    searchedLongEnough = searchedLongEnough,
                    onChoose = { service ->
                        haptics.play(HapticCue.SELECT)
                        failure = null
                        val connection = service.toConnection()
                        if (connection == null) {
                            failure = "That computer did not answer with an address. " +
                                "Enter the address shown in Phone settings instead."
                        } else {
                            openPending(connection, fromScan = false)
                        }
                    },
                )
                if (permissionSnapshot.discoveryNeedsRequest) {
                    Text(
                        text = "Searching this network needs " +
                            "${permissionSnapshot.missingDiscovery.joinToString()}, which is " +
                            "still off. The QR code and the address below work without it.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                    )
                }
                ManualSection(
                    address = manualAddress,
                    onAddressChange = { manualAddress = it },
                    onContinue = {
                        haptics.play(HapticCue.SELECT)
                        failure = null
                        val connection = Connection.parse(manualAddress)
                        if (connection == null) {
                            failure = AddressEdit.INVALID
                        } else {
                            openPending(connection, fromScan = false)
                        }
                    },
                )
            }
        }

        failure?.let {
            Text(text = it, color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
        }
    }
}

/**
 * The QR code is the way in; this is everything else, folded away until asked
 * for. Opening it is a decision with a cost — a local search, and the permission
 * that search needs — so it is a decision the person makes, not one the screen
 * makes for them.
 */
@Composable
private fun OtherWaysSection(
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = onToggle, modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Other ways to connect",
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Start,
                    fontWeight = FontWeight.SemiBold,
                )
                Icon(
                    imageVector = if (expanded) {
                        Icons.Filled.KeyboardArrowUp
                    } else {
                        Icons.Filled.KeyboardArrowDown
                    },
                    contentDescription = null,
                )
            }
        }
        if (expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(24.dp)) { content() }
        }
    }
}

internal enum class PairingFailureDisposition {
    RETAIN_ATTEMPT,
    DROP_SCANNED_ATTEMPT,
    RESET_TYPED_ATTEMPT,
}

internal fun pairingFailureDisposition(
    error: Throwable,
    cameFromScanner: Boolean,
): PairingFailureDisposition = when {
    error is PairingRouteError || error is ServerPairingRetryError -> PairingFailureDisposition.RETAIN_ATTEMPT
    cameFromScanner -> PairingFailureDisposition.DROP_SCANNED_ATTEMPT
    else -> PairingFailureDisposition.RESET_TYPED_ATTEMPT
}

@Composable
private fun SetupSection(onScan: () -> Unit) {
    SectionCard(title = "On your computer") {
        Text("1.  Open StartupBot → Settings → Phone", fontSize = 15.sp)
        Text("2.  Choose Set up a phone", fontSize = 15.sp)
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
            Text("Scan QR Code")
        }
        Text(
            text = "Scan the QR code, check the computer name, and confirm. The address and " +
                "one-time credential are filled securely for you.",
            fontSize = 13.sp,
            color = secondaryTint,
        )
    }
}

@Composable
private fun DiscoverySection(
    discovery: DiscoveryState,
    searchedLongEnough: Boolean,
    onChoose: (DiscoveredService) -> Unit,
) {
    val active = discovery as? DiscoveryState.Active
    SectionCard(title = "On this network") {
        val problem = active?.failure
        when {
            problem != null -> Text(problem, fontSize = 13.sp, color = secondaryTint)

            active == null || active.found.isEmpty() -> {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("Looking…", color = secondaryTint, fontSize = 15.sp)
                }
                if (searchedLongEnough) {
                    // NSD is multicast: it does not cross subnets, and guest
                    // networks usually block it between clients even within one.
                    // Different Wi-Fi on the two devices is by far the most
                    // common reason this list stays empty.
                    Text(
                        text = "Nothing found yet. Check that this phone and your computer are on " +
                            "the same Wi-Fi network — a guest network often blocks them from seeing " +
                            "each other. You can always enter the address below instead.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                    )
                    Text(
                        text = "If it never appears, install Tailscale on both and sign in to the " +
                            "same account — Phone settings will then show a name ending in " +
                            ".ts.net to enter below.",
                        fontSize = 13.sp,
                        color = secondaryTint,
                    )
                }
            }

            else -> Unit
        }

        active?.found?.forEach { service ->
            TextButton(
                onClick = { onChoose(service) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(service.name, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Start)
            }
        }
    }
}

@Composable
private fun ManualSection(
    address: String,
    onAddressChange: (String) -> Unit,
    onContinue: () -> Unit,
) {
    SectionCard(title = "Or enter the address") {
        OutlinedTextField(
            value = address,
            onValueChange = onAddressChange,
            placeholder = { Text("https://mac.example or 192.168.1.42:8810") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = onContinue,
            enabled = address.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Continue")
        }
        Text(
            text = "Whatever Phone settings on your computer shows — a secure https:// " +
                "address, an address on this network, or a Tailscale name like " +
                "macbook.tail1234.ts.net:8810.",
            fontSize = 13.sp,
            color = secondaryTint,
        )
    }
}

@Composable
private fun CodeSection(
    confirmation: PairingConfirmation,
    code: String,
    onCodeChange: (String) -> Unit,
    pairing: Boolean,
    onSubmit: (String) -> Unit,
    onCancel: () -> Unit,
) {
    SectionCard(title = "Confirm computer") {
        // Pairing requires an explicit destination before a credential can be confirmed.
        Text(confirmation.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Row(modifier = Modifier.fillMaxWidth()) {
            Text("Address", color = secondaryTint, fontSize = 15.sp)
            Spacer(Modifier.weight(1f))
            Text(confirmation.address, fontSize = 15.sp, fontFamily = FontFamily.Monospace)
        }
        Text(confirmation.notice, fontSize = 13.sp, color = secondaryTint)

        when (val step = confirmation.step) {
            is PairingConfirmation.Step.Confirm -> Button(
                onClick = { onSubmit(step.credential) },
                enabled = !pairing,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (pairing) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Pair with this computer")
                }
            }

            PairingConfirmation.Step.EnterCode -> {
                OutlinedTextField(
                    value = code,
                    onValueChange = onCodeChange,
                    placeholder = { Text("6-digit or ABCD-EFGH-JKLM code") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                    textStyle = MaterialTheme.typography.headlineSmall.copy(
                        fontFamily = FontFamily.Monospace,
                        textAlign = TextAlign.Center,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onSubmit(code) },
                    enabled = PairingInvite.isPairingCode(code) && !pairing,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (pairing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Connect")
                    }
                }
            }

            // An unconfirmed one-time credential cannot be replayed after restarting the app.
            PairingConfirmation.Step.Rescan -> Unit
        }

        OutlinedButton(onClick = onCancel, enabled = !pairing, modifier = Modifier.fillMaxWidth()) {
            Text("Choose a different computer")
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            text = title.uppercase(),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = secondaryTint,
        )
        HorizontalDivider()
        Spacer(Modifier.height(2.dp))
        content()
    }
}
