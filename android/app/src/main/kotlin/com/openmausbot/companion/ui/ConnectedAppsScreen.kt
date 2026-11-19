// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.openmausbot.companion.R
import com.openmausbot.companion.core.ConnectedAppsRules
import com.openmausbot.companion.core.ConnectorAccount
import com.openmausbot.companion.core.ConnectorCard
import com.openmausbot.companion.core.ConnectorCatalog
import com.openmausbot.companion.core.ConnectorStatus
import com.openmausbot.companion.core.ConnectorStatuses
import kotlinx.coroutines.launch

/** Mobile connector authorization must use the system browser; provider credentials remain on the paired computer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectedAppsScreen(onBack: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var catalog by remember { mutableStateOf<ConnectorCatalog?>(null) }
    var inventory by remember { mutableStateOf(ConnectedAppsInventory()) }
    var query by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var refreshing by remember { mutableStateOf(false) }
    var aliasTarget by rememberSaveable(stateSaver = AliasTargetSaver) {
        mutableStateOf<AliasTarget?>(null)
    }
    var alias by rememberSaveable { mutableStateOf("") }

    suspend fun refresh(showProgress: Boolean = false) {
        if (showProgress) refreshing = true
        try {
            session.loadAllConnectorStatuses()?.let { response ->
                inventory = ConnectedAppsPolicy.accept(inventory, response)
            }
        } finally {
            if (showProgress) refreshing = false
        }
    }

    fun authorize(slug: String, accountAlias: String?) {
        scope.launch {
            val url = session.authorizeConnector(slug, accountAlias) ?: return@launch
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.toASCIIString())))
            } catch (_: ActivityNotFoundException) {
                session.actionError = "This phone has no browser available to open the authorization page."
            } catch (_: SecurityException) {
                session.actionError = "The authorization page could not be opened. Check your browser restrictions and try again."
            }
        }
    }

    LaunchedEffect(Unit) {
        loading = true
        try {
            catalog = session.loadConnectorCatalog()
            refresh()
        } finally {
            loading = false
        }
    }

    // Browser authorization may finish while the app is in the background.
    var entered by remember { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        if (entered) scope.launch { refresh() } else entered = true
        onPauseOrDispose {}
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HeaderBackButton(onBack)
            Text(stringResource(R.string.ui_connected_apps), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(
                onClick = { scope.launch { refresh(showProgress = true) } },
                enabled = !refreshing,
            ) { Text(if (refreshing) stringResource(R.string.ui_refreshing) else stringResource(R.string.ui_refresh)) }
        }
        HorizontalDivider()

        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refresh(showProgress = true) } },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text(stringResource(R.string.ui_search_apps)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                if (inventory.credentialStoreUnreadable) {
                    CredentialStoreWarning(hasLastKnownInventory = inventory.statuses != null)
                }

                if (ConnectedAppsPolicy.showSetupNotice(catalog, inventory.credentialStoreUnreadable)) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(stringResource(R.string.ui_connected_apps_need_setup), fontWeight = FontWeight.SemiBold)
                            Text(
                                stringResource(R.string.ui_configure_composio_on_your_computer_first_provider_credentials_a),
                                color = secondaryTint,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }

                ConnectedAppsPolicy.filterCards(catalog?.cards.orEmpty(), query).forEach { card ->
                    ConnectorCardView(
                        card = card,
                        status = inventory.statuses?.get(card.slug),
                        hasAuthoritativeInventory = inventory.statuses != null,
                        configured = catalog?.configured == true,
                        onConnect = { authorize(card.slug, ConnectedAppsRules.firstAccountAlias) },
                        onAddAccount = {
                            alias = ""
                            aliasTarget = AliasTarget(slug = card.slug, label = card.label)
                        },
                    )
                }

                if (!loading && catalog?.cards.isNullOrEmpty()) {
                    Text(stringResource(R.string.ui_no_connected_apps_are_available_from_this_computer), color = secondaryTint)
                }

                if (loading) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                    }
                }
            }
        }
    }

    aliasTarget?.let { target ->
        val normalized = ConnectedAppsRules.additionalAccountAlias(alias)
        AlertDialog(
            onDismissRequest = { aliasTarget = null },
            title = { Text(stringResource(R.string.ui_account_alias)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = alias,
                        onValueChange = { alias = it },
                        label = { Text(stringResource(R.string.ui_work_personal_client)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        stringResource(R.string.ui_an_alias_makes_the_account_explicit_when_an_agent_uses_more_than, target.label),
                        color = secondaryTint,
                        fontSize = 13.sp,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = normalized != null,
                    onClick = {
                        aliasTarget = null
                        authorize(target.slug, normalized)
                    },
                ) { Text(stringResource(R.string.ui_continue)) }
            },
            dismissButton = { TextButton(onClick = { aliasTarget = null }) { Text(stringResource(R.string.ui_cancel)) } },
        )
    }
}


private data class AliasTarget(val slug: String, val label: String)

private val AliasTargetSaver = listSaver<AliasTarget?, String>(
    save = { target -> target?.let { listOf(it.slug, it.label) }.orEmpty() },
    restore = { saved -> saved.takeIf { it.size == 2 }?.let { AliasTarget(it[0], it[1]) } },
)

@Composable
private fun CredentialStoreWarning(hasLastKnownInventory: Boolean) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.ui_accounts_could_not_be_re_checked), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.tertiary)
            Text(
                if (hasLastKnownInventory) {
                    stringResource(R.string.ui_showing_what_was_connected_last_time_your_computer_could_not_ope)
                } else {
                    stringResource(R.string.ui_your_computer_could_not_open_its_credential_store_so_it_cannot_s)
                },
                color = secondaryTint,
                fontSize = 13.sp,
            )
        }
    }
}

@Composable
private fun ConnectorCardView(
    card: ConnectorCard,
    status: ConnectorStatus?,
    hasAuthoritativeInventory: Boolean,
    configured: Boolean,
    onConnect: () -> Unit,
    onAddAccount: () -> Unit,
) {
    val accounts = status?.accounts.orEmpty()
    val connected = status?.connected == true
    val pending = status?.pending == true

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(card.label, fontWeight = FontWeight.SemiBold)
                    Text(card.blurb, color = secondaryTint, fontSize = 13.sp)
                }
                if (pending) Text(stringResource(R.string.ui_connecting), color = secondaryTint, fontSize = 13.sp)
            }

            when {
                !hasAuthoritativeInventory -> Text(stringResource(R.string.ui_connection_unknown), color = secondaryTint)
                accounts.isEmpty() && !connected && !pending -> Button(onClick = onConnect, enabled = configured) {
                    Text(stringResource(R.string.ui_connect, card.label))
                }
                accounts.isEmpty() -> {
                    Text(if (pending) stringResource(R.string.ui_connecting) else stringResource(R.string.ui_connected))
                    Text(
                        stringResource(R.string.ui_account_details_are_unavailable_from_this_provider_refresh_after),
                        color = secondaryTint,
                        fontSize = 13.sp,
                    )
                }
                else -> {
                    accounts.forEach { account -> ConnectorAccountRow(account) }
                    TextButton(
                        onClick = onAddAccount,
                        enabled = ConnectedAppsRules.canAddAnotherAccount(accounts),
                    ) { Text(stringResource(R.string.ui_add_another_account)) }
                }
            }
        }
    }
}

@Composable
private fun ConnectorAccountRow(account: ConnectorAccount) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(account.displayName)
            Text(ConnectedAppsPolicy.statusLabel(account.status), color = secondaryTint, fontSize = 12.sp)
            SelectionContainer { Text(account.id, color = secondaryTint, fontSize = 11.sp) }
        }
        Text(if (account.isActive) stringResource(R.string.ui_active) else stringResource(R.string.ui_pending), color = secondaryTint, fontSize = 12.sp)
    }
}

data class ConnectedAppsInventory(
    val statuses: Map<String, ConnectorStatus>? = null,
    val credentialStoreUnreadable: Boolean = false,
)

object ConnectedAppsPolicy {
    fun accept(previous: ConnectedAppsInventory, response: ConnectorStatuses): ConnectedAppsInventory =
        if (response.isAuthoritative) {
            ConnectedAppsInventory(statuses = response.services)
        } else {
            previous.copy(credentialStoreUnreadable = true)
        }

    fun statusLabel(status: String): String =
        status.replace('_', ' ').split(' ').joinToString(" ") { word ->
            word.lowercase().replaceFirstChar(Char::uppercaseChar)
        }

    fun showSetupNotice(catalog: ConnectorCatalog?, credentialStoreUnreadable: Boolean): Boolean =
        catalog?.configured == false && !credentialStoreUnreadable

    fun filterCards(cards: List<ConnectorCard>, query: String): List<ConnectorCard> {
        val needle = query.trim()
        if (needle.isEmpty()) return cards
        return cards.filter { card ->
            card.label.contains(needle, ignoreCase = true) || card.slug.contains(needle, ignoreCase = true)
        }
    }
}
