// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.storage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import com.openmausbot.companion.core.CompanionEndpoint
import com.openmausbot.companion.core.CompanionEndpointKind
import com.openmausbot.companion.core.CompanionJson
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ConnectionRegistry
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DataStoreConnectionStoreTest {

    private val context: Context = RuntimeEnvironment.getApplication()

    private val airTailnet = CompanionEndpoint.create(
        "http://air-1.ts.net:8810",
        CompanionEndpointKind.TAILNET,
        priority = 0,
    )!!
    private val airHosted = CompanionEndpoint.create(
        "https://air.example.com",
        CompanionEndpointKind.HOSTED,
        priority = 1,
    )!!
    private val air = Connection(
        id = "air",
        name = "MacBook Air",
        host = "air-1.ts.net",
        port = 8810,
        hosts = listOf("air-1.ts.net"),
        activeEndpoint = airTailnet,
        endpoints = listOf(airTailnet, airHosted),
        allowedRouteKinds = setOf(CompanionEndpointKind.TAILNET, CompanionEndpointKind.HOSTED),
        allowedLocalRouteURLs = emptySet(),
    )

    private val proLan = CompanionEndpoint.direct("192.168.1.42", 8810, priority = 0)!!
    private val pro = Connection(
        id = "pro",
        name = "MacBook Pro",
        host = "192.168.1.42",
        port = 8810,
        hosts = listOf("192.168.1.42"),
        activeEndpoint = proLan,
        endpoints = listOf(proLan),
        allowedRouteKinds = setOf(CompanionEndpointKind.LAN, CompanionEndpointKind.HOSTED),
        allowedLocalRouteURLs = setOf(proLan.url),
    )

    private var openScope: CoroutineScope? = null
    private var openDataStore: DataStore<Preferences>? = null

    @After
    fun closeTheOpenStore() {
        runBlocking { close() }
    }

    @Test
    fun bothComputersAndTheirRoutePolicySurviveANewStore() = runTest {
        val file = preferencesFile("two-computers")
        relaunch(file).saveRegistry(ConnectionRegistry(listOf(air, pro), air.id))

        val restored = relaunch(file).loadRegistry()

        assertFalse(restored.migratedLegacyConnection, "a v1 read is not a migration")
        assertEquals(listOf("air", "pro"), restored.registry.connections.map(Connection::id))
        assertEquals("air", restored.registry.activeConnectionId)
        assertRestored(air, restored.registry.connection("air"))
        assertRestored(pro, restored.registry.connection("pro"))
    }

    @Test
    fun theOldSingleRecordIsLiftedIntoTheRegistry() = runTest {
        val file = preferencesFile("legacy-lift")
        relaunch(file)
        writeLegacyKey(pro)

        val restored = relaunch(file).loadRegistry()

        assertTrue(restored.migratedLegacyConnection, "the lift is what tells the caller to write v1 back")
        assertEquals(listOf(pro), restored.registry.connections)
        assertEquals(pro.id, restored.registry.activeConnectionId)
        assertRestored(pro, restored.registry.connection(pro.id))
    }

    @Test
    fun aCorruptRegistryHasNoLegacyRecordLeftToFallBackOn() = runTest {
        val file = preferencesFile("corrupt-v1")
        val store = relaunch(file)
        writeLegacyKey(air)
        store.saveRegistry(ConnectionRegistry(listOf(pro), pro.id))
        assertNull(rawPreferences()[DataStoreConnectionStore.KEY])
        corruptTheRegistry()

        val restored = relaunch(file).loadRegistry()

        assertEquals(emptyList(), restored.registry.connections)
        assertNull(restored.registry.activeConnectionId)
        assertFalse(restored.migratedLegacyConnection)
    }

    @Test
    fun aLegacySaveAfterTheRegistryCannotResurrectARemovedComputer() = runTest {
        val file = preferencesFile("no-resurrection")
        val store = relaunch(file)
        store.saveRegistry(ConnectionRegistry(listOf(air, pro), air.id))
        store.save(air.copy(name = "Air at home"))
        assertNull(rawPreferences()[DataStoreConnectionStore.KEY])
        corruptTheRegistry()

        val restored = relaunch(file).loadRegistry()

        assertEquals(emptyList(), restored.registry.connections)
        assertNull(restored.registry.activeConnectionId)
        assertFalse(restored.migratedLegacyConnection)
    }

    @Test
    fun theLegacySaveNeitherReplacesTheRegistryNorDropsTheSecondComputer() = runTest {
        val file = preferencesFile("legacy-save")
        val store = relaunch(file)
        store.saveRegistry(ConnectionRegistry(listOf(air, pro), air.id))
        store.save(air.copy(name = "Air at home"))

        assertNull(rawPreferences()[DataStoreConnectionStore.KEY])

        val restored = relaunch(file).loadRegistry()

        assertEquals(listOf("air", "pro"), restored.registry.connections.map(Connection::id))
        assertEquals("Air at home", restored.registry.connection("air")?.name)
        assertEquals("air", restored.registry.activeConnectionId)
        assertRestored(pro, restored.registry.connection("pro"))
        assertFalse(restored.migratedLegacyConnection)
    }

    private fun assertRestored(expected: Connection, actual: Connection?) {
        val restored = requireNotNull(actual) { "${expected.id} did not come back" }
        assertEquals(expected.name, restored.name)
        assertEquals(expected.host, restored.host)
        assertEquals(expected.port, restored.port)
        assertEquals(expected.hosts, restored.hosts)
        assertEquals(expected.activeEndpoint, restored.activeEndpoint)
        assertEquals(expected.endpoints, restored.endpoints)
        assertEquals(expected.allowedRouteKinds, restored.allowedRouteKinds)
        assertEquals(expected.allowedLocalRouteURLs, restored.allowedLocalRouteURLs)
        assertEquals(expected, restored)
    }

    private fun preferencesFile(name: String) = File(context.filesDir, "$name.preferences_pb")

    private suspend fun relaunch(file: File): DataStoreConnectionStore {
        close()
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val dataStore = PreferenceDataStoreFactory.create(scope = scope) { file }
        openScope = scope
        openDataStore = dataStore
        return DataStoreConnectionStore(dataStore)
    }

    private suspend fun close() {
        val scope = openScope ?: return
        openScope = null
        openDataStore = null
        scope.cancel()
        scope.coroutineContext.job.join()
    }

    private suspend fun rawPreferences(): Preferences =
        requireNotNull(openDataStore) { "no store is open" }.data.first()

    private suspend fun writeLegacyKey(connection: Connection) {
        requireNotNull(openDataStore) { "no store is open" }.edit { preferences ->
            preferences[DataStoreConnectionStore.KEY] =
                CompanionJson.encodeToString(connection)
        }
    }

    private suspend fun corruptTheRegistry() {
        requireNotNull(openDataStore) { "no store is open" }.edit { preferences ->
            preferences[DataStoreConnectionStore.REGISTRY_KEY] = "{not a registry"
        }
    }
}
