// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.content.ClipData
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.ActivityDetail
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenRoutines: (() -> Unit)? = null,
    onOpenConnectedApps: (() -> Unit)? = null,
    onOpenVoice: (() -> Unit)? = null,
    onConnect: (() -> Unit)? = null,
) {
    val resources = androidx.compose.ui.platform.LocalResources.current
    val environment = LocalCompanion.current
    val session = environment.session
    val connection by session.connection.collectAsState()
    val connections by session.connections.collectAsState()
    val status by session.status.collectAsState()
    val notifications by environment.notifications.access.collectAsState()
    val activityDetail by environment.chatPreferences.activityDetail.collectAsState()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    val haptics = rememberHaptics()

    var editingAddress by remember { mutableStateOf(false) }
    var addressText by remember { mutableStateOf("") }
    var addressError by remember { mutableStateOf<String?>(null) }
    var showingFullAddress by remember { mutableStateOf(false) }
    var addressCopied by remember { mutableStateOf(false) }
    var reconnecting by remember { mutableStateOf(false) }
    var confirmingUnpair by remember { mutableStateOf(false) }
    var pendingComputerRemoval by remember { mutableStateOf<Connection?>(null) }
    var choosingActivity by remember { mutableStateOf(false) }
    var editingQuickReplies by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(stringResource(R.string.ui_settings), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        HorizontalDivider()

        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SettingsSection(stringResource(R.string.ui_computer)) {
                val bound = connection
                if (bound != null) {
                    val address = SettingsPolicy.addressText(bound)
                    SettingsRow(stringResource(R.string.ui_name), bound.name)
                    AddressRow(
                        address = address,
                        expanded = showingFullAddress,
                        copied = addressCopied,
                        onToggle = { showingFullAddress = !showingFullAddress },
                        onCopy = {
                            scope.launch {
                                clipboard.setClipEntry(
                                    ClipEntry(ClipData.newPlainText(ADDRESS_CLIP_LABEL, address)),
                                )
                                addressCopied = true
                                delay(COPIED_LABEL_MILLIS)
                                addressCopied = false
                            }
                        },
                    )
                    SettingsButton(stringResource(R.string.ui_edit_address)) {
                        addressText = address
                        addressError = null
                        editingAddress = true
                    }
                } else if (onConnect != null) {
                    SettingsButton(stringResource(R.string.ui_connect_a_computer), onClick = onConnect)
                }
                SettingsRow(stringResource(R.string.ui_connection), SettingsPolicy.statusText(resources, status))
                if (bound != null) {
                    SettingsButton(stringResource(R.string.ui_connect_another_computer)) {
                        haptics.play(TactileAction.CONNECT_ANOTHER_COMPUTER)
                        session.beginPairing()
                    }
                }
            }

            val otherComputers = connections.filter { it.id != connection?.id }
            if (otherComputers.isNotEmpty()) {
                SettingsSection(stringResource(R.string.ui_other_computers)) {
                    otherComputers.forEach { computer ->
                        SettingsButton(stringResource(R.string.ui_use, computer.name)) {
                            haptics.play(TactileAction.SWITCH_COMPUTER)
                            session.switchComputer(computer.id)
                        }
                        SettingsButton(stringResource(R.string.ui_remove, computer.name), destructive = true) {
                            pendingComputerRemoval = computer
                        }
                    }
                    Footnote(stringResource(R.string.ui_each_computer_is_paired_separately_only_the_selected_computer_is))
                }
            }

            if (connection != null) {
                SettingsSection(stringResource(R.string.ui_troubleshooting)) {
                    Footnote(troubleshootingText(status))
                    SettingsButton(
                        text = stringResource(R.string.ui_try_reconnecting),
                        enabled = !reconnecting,
                        trailing = {
                            if (reconnecting) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                )
                            }
                        },
                    ) {
                        scope.launch {
                            reconnecting = true
                            session.refresh()
                            reconnecting = false
                        }
                    }
                }
            }

            SettingsSection(stringResource(R.string.ui_notifications)) {
                SettingsRow(
                    stringResource(R.string.ui_status),
                    NotificationPermissionController.statusText(resources, notifications),
                )
                SettingsButton(
                    text = NotificationPermissionController.buttonText(resources, notifications),
                    enabled = NotificationPermissionController.buttonEnabled(notifications),
                    onClick = environment.notifications::act,
                )
                Footnote(stringResource(R.string.ui_settingspolicy_notifications_footer))
            }

            SettingsSection(stringResource(R.string.ui_background_connection)) {
                val alwaysOnEnabled by environment.alwaysOnEnabled.collectAsState()
                SettingsRow(stringResource(R.string.ui_status), if (alwaysOnEnabled) "Always on" else "Only while open")
                SettingsButton(
                    text = if (alwaysOnEnabled) stringResource(R.string.ui_turn_off) else stringResource(R.string.ui_turn_on),
                    onClick = environment.onToggleAlwaysOn,
                )
                Footnote(
                    if (alwaysOnEnabled) {
                        "StartupBot keeps a permanent notification while this is on, so scheduled " +
                            "reminders and routine results reach you even with the app fully closed."
                    } else {
                        "Notifications only arrive while the app is open or was recently backgrounded. " +
                            "Turn this on if you rely on scheduled routines to notify you later — it adds " +
                            "a permanent low-priority notification and uses a little more battery."
                    },
                )
            }

            SettingsSection(stringResource(R.string.ui_chat)) {
                SettingsRow(stringResource(R.string.ui_activity), activityDetail.label)
                SettingsButton(stringResource(R.string.ui_change_activity_detail)) { choosingActivity = true }
                SettingsButton(stringResource(R.string.ui_quick_replies)) { editingQuickReplies = true }
                Footnote(activityDetail.caption)
            }

            if (onOpenRoutines != null || onOpenConnectedApps != null || onOpenVoice != null) {
                SettingsSection(stringResource(R.string.ui_workspace)) {
                    onOpenRoutines?.let { openRoutines ->
                        SettingsButton(
                            text = stringResource(R.string.ui_threads_routines),
                            icon = R.drawable.ic_schedule,
                            onClick = openRoutines,
                        )
                    }
                    onOpenConnectedApps?.let { openConnectedApps ->
                        SettingsButton(
                            text = stringResource(R.string.ui_connected_apps),
                            onClick = openConnectedApps,
                        )
                    }
                    onOpenVoice?.let { openVoice ->
                        SettingsButton(
                            text = stringResource(R.string.ui_voice),
                            icon = R.drawable.ic_phone,
                            onClick = openVoice,
                        )
                    }
                    Footnote(stringResource(R.string.ui_settingspolicy_workspace_footer))
                }
            }

            if (connection != null) {
                SettingsSection(null) {
                    SettingsButton(
                        text = if (connections.size > 1) stringResource(R.string.ui_remove_this_computer) else stringResource(R.string.ui_unpair_this_phone),
                        destructive = true,
                    ) { confirmingUnpair = true }
                    Footnote(stringResource(R.string.ui_settingspolicy_unpair_footer))
                }
            }

            SettingsSection(stringResource(R.string.ui_not_here)) {
                Footnote(stringResource(R.string.ui_settingspolicy_not_here))
            }
        }
    }

    if (editingAddress) {
        AlertDialog(
            onDismissRequest = { editingAddress = false },
            title = { Text(stringResource(R.string.ui_edit_address)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.ui_settingspolicy_edit_address_message), fontSize = 14.sp)
                    OutlinedTextField(
                        value = addressText,
                        onValueChange = {
                            addressText = it
                            addressError = null
                        },
                        placeholder = { Text("https://mac.example or 192.168.1.42:8810") },
                        singleLine = true,
                        isError = addressError != null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    addressError?.let {
                        Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (session.updateAddress(addressText)) {
                            editingAddress = false
                        } else {
                            addressError = AddressEdit.INVALID
                        }
                    },
                ) { Text(stringResource(R.string.ui_save)) }
            },
            dismissButton = {
                TextButton(onClick = { editingAddress = false }) { Text(stringResource(R.string.ui_cancel)) }
            },
        )
    }

    if (confirmingUnpair) {
        AlertDialog(
            onDismissRequest = { confirmingUnpair = false },
            title = { Text(if (connections.size > 1) stringResource(R.string.ui_remove_163, connection?.name.orEmpty()) else stringResource(R.string.ui_settingspolicy_unpair_confirm_title)) },
            text = {
                Text(
                    if (connections.size > 1) {
                        stringResource(R.string.ui_this_removes_the_saved_connection_from_this_phone_only_another_s)
                    } else {
                        stringResource(R.string.ui_settingspolicy_unpair_confirm_message)
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmingUnpair = false
                        // Forgetting local credentials does not revoke the computer's device grant.
                        session.signOut()
                    },
                ) {
                    Text(
                        text = if (connections.size > 1) stringResource(R.string.ui_remove_165) else stringResource(R.string.ui_unpair),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingUnpair = false }) { Text(stringResource(R.string.ui_cancel)) }
            },
        )
    }

    pendingComputerRemoval?.let { computer ->
        AlertDialog(
            onDismissRequest = { pendingComputerRemoval = null },
            title = { Text(stringResource(R.string.ui_remove_163, computer.name)) },
            text = { Text(stringResource(R.string.ui_this_removes_the_saved_connection_from_this_phone_only)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingComputerRemoval = null
                        session.forgetConnection(computer.id)
                    },
                ) { Text(stringResource(R.string.ui_remove_165), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { pendingComputerRemoval = null }) { Text(stringResource(R.string.ui_cancel)) }
            },
        )
    }

    if (choosingActivity) {
        AlertDialog(
            onDismissRequest = { choosingActivity = false },
            title = { Text(stringResource(R.string.ui_activity_detail)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    ActivityDetail.entries.forEach { detail ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = MIN_TOUCH_TARGET)
                                .selectable(
                                    selected = detail == activityDetail,
                                    role = Role.RadioButton,
                                    onClick = {
                                        environment.chatPreferences.setActivityDetail(detail)
                                        choosingActivity = false
                                    },
                                )
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = detail == activityDetail, onClick = null)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(detail.label, textAlign = TextAlign.Start)
                                Text(detail.caption, fontSize = 12.sp, color = secondaryTint)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { choosingActivity = false }) { Text(stringResource(R.string.ui_cancel)) } },
        )
    }

    if (editingQuickReplies) {
        QuickRepliesEditor(
            preferences = environment.chatPreferences,
            onDismiss = { editingQuickReplies = false },
        )
    }
}

@Composable
private fun SettingsSection(title: String?, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        title?.let {
            Text(
                text = it.uppercase(),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = secondaryTint,
            )
        }
        HorizontalDivider()
        content()
    }
}

@Composable
private fun SettingsRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, fontSize = 15.sp, color = secondaryTint)
        Text(
            text = value,
            fontSize = 15.sp,
            textAlign = TextAlign.End,
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
        )
    }
}

@Composable
private fun AddressRow(
    address: String,
    expanded: Boolean,
    copied: Boolean,
    onToggle: () -> Unit,
    onCopy: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.ui_address), fontSize = 15.sp, color = secondaryTint)
        if (expanded) {
            SelectionContainer {
                Text(
                    text = address,
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace,
                    color = secondaryTint,
                )
            }
        } else {
            Text(
                text = shortenedAddress(address),
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = secondaryTint,
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = onToggle) {
                Text(if (expanded) stringResource(R.string.ui_hide_full_address) else stringResource(R.string.ui_show_full_address))
            }
            TextButton(onClick = onCopy) {
                Text(if (copied) stringResource(R.string.ui_copied) else stringResource(R.string.ui_copy))
            }
        }
    }
}

@Composable
private fun SettingsButton(
    text: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    icon: Int? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    val tint = if (destructive) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.primary
    }
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.let {
                Icon(
                    painter = painterResource(it),
                    contentDescription = null,
                    tint = tint,
                    modifier = Modifier.size(20.dp),
                )
            }
            Text(
                text = text,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Start,
                color = tint,
            )
            trailing?.invoke()
        }
    }
}

@Composable
private fun Footnote(text: String) {
    Text(text = text, fontSize = 13.sp, color = secondaryTint)
}

private const val ADDRESS_CLIP_LABEL = "StartupBot computer address"

private const val COPIED_LABEL_MILLIS = 2_000L

internal fun troubleshootingText(status: Session.Status): String = when (status) {
    Session.Status.Live -> "This computer is connected and responding normally."
    Session.Status.Connecting -> "StartupBot is trying the saved connection automatically."
    Session.Status.Unauthorized -> "This phone was removed from the computer. Pair it again to reconnect."
    Session.Status.Unpaired -> "This phone is not paired with a computer."
    is Session.Status.Offline -> status.message
}

internal fun shortenedAddress(address: String): String {
    if (address.length <= 14) return address
    val leading = minOf(20, maxOf(8, address.length - 8))
    return address.take(leading) + "…" + address.takeLast(6)
}
