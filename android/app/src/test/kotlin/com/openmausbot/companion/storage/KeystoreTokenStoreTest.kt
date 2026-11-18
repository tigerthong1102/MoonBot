// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.storage

import android.content.SharedPreferences
import com.openmausbot.companion.core.TokenStore
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout


class KeystoreTokenStoreTest {

    private val ioThreadName = "token-store-io"
    private val callerThreadName = "token-store-caller"

    @Test
    fun `the prefs provider and every access run on the injected io context`() {
        val prefs = RecordingPrefs()
        val io = Executors.newSingleThreadExecutor { Thread(it, ioThreadName) }
        try {
            val store = KeystoreTokenStore(
                prefsProvider = {
                    prefs.touches += Thread.currentThread().name.substringBefore(" @")
                    prefs
                },
                io = io.asCoroutineDispatcher(),
            )
            onCallerThread {
                store.save("c1", "tok")
                store.read("c1")
                store.remove("c1")
            }

            assertTrue(prefs.touches.isNotEmpty(), "the fake was never touched at all")
            assertEquals(
                setOf(ioThreadName),
                prefs.touches.toSet(),
                "Keystore work reached a thread that is not the injected io context: ${prefs.touches}",
            )
        } finally {
            io.shutdownNow()
        }
    }

    @Test
    fun `the token write is committed, not applied`() = runBlocking {
        val prefs = RecordingPrefs()
        val store = store(prefs)

        store.save("c1", "tok")
        store.remove("c1")

        assertEquals(2, prefs.commits.get(), "both writers must wait for the bytes")
        assertEquals(0, prefs.applies.get(), "apply() returns before the token is durable")
    }

    @Test
    fun `a failed token commit fails pairing instead of saving a broken connection`() = runBlocking {
        val prefs = RecordingPrefs(commitSucceeds = false)
        val store = store(prefs)

        val failure = assertFailsWith<TokenStoreException> { store.save("c1", "tok") }

        assertFalse(failure.locked)
        assertEquals("The device token write did not land.", failure.message)
        assertEquals(TokenStore.ReadResult.Missing, store.read("c1"))
    }

    @Test
    fun `a saved token reads back and a missing one reads Missing`() = runBlocking {
        val prefs = RecordingPrefs()
        val store = store(prefs)

        store.save("c1", "tok")

        assertEquals(TokenStore.ReadResult.Found("tok"), store.read("c1"))
        assertEquals(TokenStore.ReadResult.Missing, store.read("c2"))
        store.remove("c1")
        assertEquals(TokenStore.ReadResult.Missing, store.read("c1"))
    }

    @Test
    fun `a keystore failure is still reported as a store failure`() = runBlocking {
        val store = KeystoreTokenStore(
            prefsProvider = { throw java.security.KeyStoreException("keystore is locked") },
            io = kotlin.coroutines.EmptyCoroutineContext,
        )

        val failure = assertFailsWith<TokenStoreException> { store.save("c1", "tok") }
        assertTrue(failure.locked)
        val read = store.read("c1")
        assertTrue(read is TokenStore.ReadResult.Unavailable && read.locked)
    }


    @Test
    fun `cancellation propagates instead of becoming a store failure`() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val prefs = RecordingPrefs()
        val store = KeystoreTokenStore(
            prefsProvider = {
                entered.complete(Unit)
                runBlocking { release.await() }
                prefs
            },
            io = kotlin.coroutines.EmptyCoroutineContext,
        )
        var outcome: Throwable? = null

        val job = Job()
        CoroutineScope(job).launch {
            try {
                store.read("c1")
            } catch (error: Throwable) {
                outcome = error
            }
        }
        withTimeout(2_000) { entered.await() }
        job.cancel()
        release.complete(Unit)
        withTimeout(2_000) { job.join() }

        assertTrue(
            outcome is CancellationException,
            "a cancelled read must stay cancelled, not become a store verdict: $outcome",
        )
    }

    private fun store(prefs: SharedPreferences) = KeystoreTokenStore(
        prefsProvider = { prefs },
        io = kotlin.coroutines.EmptyCoroutineContext,
    )

    private fun onCallerThread(block: suspend () -> Unit) {
        var failure: Throwable? = null
        val thread = Thread({
            try {
                runBlocking { block() }
            } catch (error: Throwable) {
                failure = error
            }
        }, callerThreadName)
        thread.start()
        thread.join(5_000)
        failure?.let { throw it }
    }

    private class RecordingPrefs(
        val commitSucceeds: Boolean = true,
    ) : SharedPreferences {
        val values = mutableMapOf<String, String?>()
        val touches = mutableListOf<String>()
        val commits = AtomicInteger(0)
        val applies = AtomicInteger(0)

        private fun mark() {
            touches += Thread.currentThread().name.substringBefore(" @")
        }

        override fun getAll(): MutableMap<String, *> = values.also { mark() }

        override fun getString(key: String?, defValue: String?): String? {
            mark()
            return values[key] ?: defValue
        }

        override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? {
            mark()
            return defValues
        }

        override fun getInt(key: String?, defValue: Int): Int = defValue.also { mark() }
        override fun getLong(key: String?, defValue: Long): Long = defValue.also { mark() }
        override fun getFloat(key: String?, defValue: Float): Float = defValue.also { mark() }
        override fun getBoolean(key: String?, defValue: Boolean): Boolean = defValue.also { mark() }
        override fun contains(key: String?): Boolean {
            mark()
            return values.containsKey(key)
        }

        override fun edit(): SharedPreferences.Editor {
            mark()
            return RecordingEditor(this)
        }

        override fun registerOnSharedPreferenceChangeListener(
            listener: SharedPreferences.OnSharedPreferenceChangeListener?,
        ) = Unit

        override fun unregisterOnSharedPreferenceChangeListener(
            listener: SharedPreferences.OnSharedPreferenceChangeListener?,
        ) = Unit
    }

    private class RecordingEditor(private val prefs: RecordingPrefs) : SharedPreferences.Editor {
        private val pending = mutableListOf<() -> Unit>()

        private fun mark() {
            prefs.touches += Thread.currentThread().name.substringBefore(" @")
        }

        override fun putString(key: String?, value: String?): SharedPreferences.Editor {
            mark()
            pending += { prefs.values[key!!] = value }
            return this
        }

        override fun putStringSet(key: String?, values: MutableSet<String>?) = this
        override fun putInt(key: String?, value: Int) = this
        override fun putLong(key: String?, value: Long) = this
        override fun putFloat(key: String?, value: Float) = this
        override fun putBoolean(key: String?, value: Boolean) = this

        override fun remove(key: String?): SharedPreferences.Editor {
            mark()
            pending += { prefs.values.remove(key) }
            return this
        }

        override fun clear(): SharedPreferences.Editor = this

        override fun commit(): Boolean {
            mark()
            prefs.commits.incrementAndGet()
            if (prefs.commitSucceeds) pending.forEach { it() }
            return prefs.commitSucceeds
        }

        override fun apply() {
            mark()
            prefs.applies.incrementAndGet()
            pending.forEach { it() }
        }
    }
}
