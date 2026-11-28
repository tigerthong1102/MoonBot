package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.material3.Checkbox
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import com.openmausbot.companion.R
import com.openmausbot.companion.core.CompanionClient
import com.openmausbot.companion.core.Connection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun mobileChatOrigin() = personalInboxOrigin(stringResource(R.string.startupbot_mobile_origin))

@Composable
internal fun MobileChatButton() {
    val origin = mobileChatOrigin() ?: return
    val connection = remember(origin) { Connection.parse(origin.toString()) } ?: return
    var showing by remember { mutableStateOf(false) }
    OutlinedButton(onClick = { showing = true }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.mobile_standalone_chat))
    }
    if (showing) MobileEmailLogin(connection) { showing = false }
}

@Composable
private fun MobileEmailLogin(connection: Connection, close: () -> Unit) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var handoffAvailable by remember { mutableStateOf(false) }
    var allowDrafts by remember { mutableStateOf(false) }
    var saveHistory by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(onDismissRequest = close, title = { Text(stringResource(R.string.mobile_standalone_chat)) },
        text = {
            Column {
                OutlinedTextField(email, { email = it }, enabled = !busy && !sent, singleLine = true,
                    label = { Text("Email") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                if (sent) {
                    if (handoffAvailable) {
                        Row(Modifier.toggleable(value = allowDrafts, onValueChange = { allowDrafts = it }),
                            verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = allowDrafts, onCheckedChange = null)
                            Text(stringResource(R.string.mobile_allow_drafts))
                        }
                    }
                    Row(Modifier.toggleable(value = saveHistory, onValueChange = { saveHistory = it }),
                        verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = saveHistory, onCheckedChange = null)
                        Text(stringResource(R.string.mobile_save_history))
                    }
                    OutlinedTextField(code, { code = it }, enabled = !busy, singleLine = true,
                        label = { Text(stringResource(R.string.mobile_otp)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    TextButton(enabled = !busy, onClick = { sent = false; code = ""; error = null }) {
                        Text(stringResource(R.string.mobile_change_email))
                    }
                }
                error?.let { Text(it) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && email.isNotBlank() && (!sent || (code.isNotBlank() && saveHistory)), onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        if (sent) {
                            session.signInToMobile(connection, email.trim(), code.trim(), allowDrafts)
                            close()
                        } else {
                            handoffAvailable = CompanionClient(connection, null).requestMobileCode(email.trim()).desktopHandoff
                            allowDrafts = false
                            saveHistory = false
                            sent = true
                        }
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) { error = e.localizedMessage }
                    finally { busy = false }
                }
            }) { Text(stringResource(if (sent) R.string.mobile_sign_in else R.string.mobile_send_code)) }
        },
        dismissButton = { TextButton(onClick = close) { Text(stringResource(android.R.string.cancel)) } },
    )
}
