// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.avatar

import com.openmausbot.companion.core.AvatarCrop
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.ModelSelection
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout


class AvatarImageStoreTest {

    @Test
    fun `bytesFor returns null without fetching when the bot has no avatarUrl`() = runTest {
        var fetches = 0
        val store = AvatarImageStore(
            fetch = {
                fetches += 1
                byteArrayOf(1)
            },
            decode = { null },
        )
        assertNull(store.bytesFor(bot(avatarUrl = null)))
        assertEquals(0, fetches)
    }

    @Test
    fun `a second read for the same path does not fetch again`() = runTest {
        var fetches = 0
        val store = AvatarImageStore(
            fetch = {
                fetches += 1
                byteArrayOf(9, 9, 9)
            },
            decode = { null },
        )
        val first = store.bytesFor(bot(avatarUrl = "/api/attachments/a.png"))
        val second = store.bytesFor(bot(avatarUrl = "/api/attachments/a.png"))
        assertContentEquals(byteArrayOf(9, 9, 9), first)
        assertContentEquals(first, second)
        assertEquals(1, fetches)
        assertEquals(1, store.cachedEntryCount())
    }

    @Test
    fun `concurrent first renders share one download`() = runTest {
        var fetches = 0
        val release = Mutex(locked = true)
        val store = AvatarImageStore(
            fetch = {
                fetches += 1
                release.withLock { }
                byteArrayOf(4, 2)
            },
            decode = { null },
        )
        val a = async { store.bytesFor(bot(avatarUrl = "/api/attachments/shared.webp")) }
        val b = async { store.bytesFor(bot(avatarUrl = "/api/attachments/shared.webp")) }
        delay(20)
        release.unlock()
        assertContentEquals(byteArrayOf(4, 2), a.await())
        assertContentEquals(byteArrayOf(4, 2), b.await())
        assertEquals(1, fetches)
    }

    @Test
    fun `clear drops cached bytes and ignores a stale in-flight put`() = runTest {
        val release = Mutex(locked = true)
        val store = AvatarImageStore(
            fetch = {
                release.withLock { }
                byteArrayOf(7)
            },
            decode = { null },
        )
        val pending = async { store.bytesFor(bot(avatarUrl = "/api/attachments/stale.png")) }
        delay(20)
        store.clear()
        release.unlock()
        assertNull(pending.await())
        assertEquals(0, store.cachedEntryCount())
        assertEquals(0, store.cachedByteCost())
    }

    @Test
    fun `encoded byte budgets match the iOS NSCache limits`() = runTest {

        assertEquals(64, AvatarImageStore.DEFAULT_MAX_ENTRIES)
        assertEquals(32 * 1_024 * 1_024, AvatarImageStore.DEFAULT_MAX_BYTES)
        assertEquals(64, AvatarImageStore.DEFAULT_MAX_BITMAP_ENTRIES)
        assertEquals(32 * 1_024 * 1_024, AvatarImageStore.DEFAULT_MAX_BITMAP_BYTES)
        assertEquals(1_024, AvatarImageStore.DEFAULT_MAX_DECODE_EDGE)

        val store = AvatarImageStore(
            fetch = { bot -> ByteArray(4) { bot.id.last().code.toByte() } },
            decode = { null },
            maxEntries = 2,
            maxBytes = 10,
        )
        store.bytesFor(bot(id = "b1", avatarUrl = "/api/attachments/1.png"))
        store.bytesFor(bot(id = "b2", avatarUrl = "/api/attachments/2.png"))
        store.bytesFor(bot(id = "b3", avatarUrl = "/api/attachments/3.png"))
        assertTrue(store.cachedEntryCount() <= 2)
        assertTrue(store.cachedByteCost() <= 10)
    }

    @Test
    fun `clearBlocking bumps generation so a late fetch cannot repopulate`() = runTest {
        val release = Mutex(locked = true)
        val store = AvatarImageStore(
            fetch = {
                release.withLock { }
                byteArrayOf(1, 2, 3, 4)
            },
            decode = { null },
        )
        backgroundScope.launch { store.bytesFor(bot(avatarUrl = "/api/attachments/late.png")) }
        delay(20)
        store.clearBlocking()
        release.unlock()
        delay(20)
        assertEquals(0, store.cachedEntryCount())
    }

    @Test
    fun `inSampleSize shrinks both edges within the decode budget`() {
        assertEquals(1, AvatarImageStore.inSampleSizeFor(512, 512, maxEdge = 1_024))
        assertEquals(1, AvatarImageStore.inSampleSizeFor(1_024, 800, maxEdge = 1_024))
        assertEquals(2, AvatarImageStore.inSampleSizeFor(2_000, 1_500, maxEdge = 1_024))
        assertEquals(8, AvatarImageStore.inSampleSizeFor(8_000, 6_000, maxEdge = 1_024))
        assertEquals(16, AvatarImageStore.inSampleSizeFor(12_000, 9_000, maxEdge = 1_024))
    }

    @Test
    fun `bitmap cache evicts by byte cost not only by entry count`() {
        // Would pass against a count-only cache of 64: three entries fit easily.
        // Fails unless eviction accounts cost the way NSCache totalCostLimit does.
        val cache = BoundedCostCache(
            maxEntries = 64,
            maxBytes = 100,
            costOf = { value: String -> value.toInt() },
        )
        cache.putIfAbsent("a", "40")
        cache.putIfAbsent("b", "40")
        cache.putIfAbsent("c", "40")
        assertTrue(cache.size() <= 2, "third 40-byte frame must evict by cost")
        assertTrue(cache.byteCost() <= 100)
        assertNull(cache.get("a"), "eldest must be evicted first")
        assertEquals("40", cache.get("c"))
    }

    @Test
    fun `bitmapFor retains decoded frames by reported cost and evicts over budget`() = runBlocking {
        val store = AvatarImageStore(
            fetch = { byteArrayOf(1) },
            decode = { bytes ->
                DecodedAvatar.forTest(byteCost = 40 + bytes.size)
            },
            maxBitmapEntries = 64,
            maxBitmapBytes = 100,
        )
        store.bitmapFor(bot(id = "a", avatarUrl = "/api/attachments/a.png"))
        store.bitmapFor(bot(id = "b", avatarUrl = "/api/attachments/b.png"))
        store.bitmapFor(bot(id = "c", avatarUrl = "/api/attachments/c.png"))
        assertTrue(store.cachedBitmapCount() <= 2)
        assertTrue(store.cachedBitmapByteCost() <= 100)
        assertTrue(store.cachedBitmapCount() >= 1, "at least the newest frame stays")
    }

    @Test
    fun `bitmapFor turns OutOfMemoryError into a mascot fallback`() = runBlocking {
        var explode = true
        val store = AvatarImageStore(
            fetch = { byteArrayOf(1, 2, 3) },
            decode = {
                if (explode) throw OutOfMemoryError("simulated decode pressure")
                DecodedAvatar.forTest(byteCost = 16)
            },
        )
        assertNull(store.bitmapFor(bot(avatarUrl = "/api/attachments/oom.png")))
        assertEquals(0, store.cachedBitmapCount())
        explode = false
        assertNull(store.bitmapFor(bot(avatarUrl = "/api/attachments/oom.png")))
        assertEquals(1, store.cachedBitmapCount())
        assertEquals(16, store.cachedBitmapByteCost())
    }

    @Test
    fun `sampled frame cost matches inSampleSize ARGB accounting`() {
        val maxEdge = AvatarImageStore.DEFAULT_MAX_DECODE_EDGE
        val sample = AvatarImageStore.inSampleSizeFor(8_000, 6_000, maxEdge)
        assertEquals(8, sample)
        val sampledCost = (8_000 / sample) * (6_000 / sample) * 4
        assertEquals(1_000 * 750 * 4, sampledCost)

        val cache = BoundedCostCache(
            maxEntries = 64,
            maxBytes = sampledCost + 1,
            costOf = { frame: DecodedAvatar -> frame.byteCost },
        )
        val frame = DecodedAvatar.forTest(byteCost = sampledCost)
        assertEquals(frame, cache.putIfAbsent("hostile", frame))
        assertEquals(1, cache.size())
        assertEquals(sampledCost, cache.byteCost())
        cache.putIfAbsent("next", DecodedAvatar.forTest(byteCost = sampledCost))
        assertEquals(1, cache.size())
        assertNull(cache.get("hostile"))
    }

    @Test
    fun `concurrent bitmapFor shares one decode for the same path`() = runBlocking {
        val decodes = AtomicInteger(0)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val store = AvatarImageStore(
            fetch = { byteArrayOf(1, 2, 3) },
            decode = {
                decodes.incrementAndGet()
                started.countDown()
                check(release.await(2, TimeUnit.SECONDS))
                DecodedAvatar.forTest(byteCost = 32)
            },
        )
        val a = async(Dispatchers.Default) {
            store.bitmapFor(bot(avatarUrl = "/api/attachments/shared.png"))
        }
        val b = async(Dispatchers.Default) {
            store.bitmapFor(bot(avatarUrl = "/api/attachments/shared.png"))
        }
        assertTrue(started.await(2, TimeUnit.SECONDS))
        withContext(Dispatchers.Default) { Thread.sleep(30) }
        release.countDown()
        assertNull(a.await())
        assertNull(b.await())
        assertEquals(1, decodes.get(), "two first renders must share one decode")
        assertEquals(1, store.cachedBitmapCount())
        assertEquals(32, store.cachedBitmapByteCost())
    }

    @Test
    fun `cancelling the decode leader unblocks joiners and clears inflight`() = runBlocking {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val store = AvatarImageStore(
            fetch = { byteArrayOf(9) },
            decode = {
                started.countDown()
                check(release.await(2, TimeUnit.SECONDS))
                DecodedAvatar.forTest(byteCost = 8)
            },
        )
        val leader = async(Dispatchers.Default) {
            store.bitmapFor(bot(avatarUrl = "/api/attachments/cancel.png"))
        }
        assertTrue(started.await(2, TimeUnit.SECONDS))
        val joiner = async(Dispatchers.Default) {
            store.bitmapFor(bot(avatarUrl = "/api/attachments/cancel.png"))
        }
        withContext(Dispatchers.Default) { Thread.sleep(30) }
        leader.cancel()
        withTimeout(2_000) {
            assertNull(joiner.await())
        }
        release.countDown()
        withTimeout(2_000) { leader.join() }
        val again = store.bitmapFor(bot(avatarUrl = "/api/attachments/cancel.png"))
        assertNull(again)
        assertEquals(1, store.cachedBitmapCount())
    }

    @Test
    fun `a cancelled bytes leader clears its inflight entry while the lock is held`() = runBlocking {
        val slowPath = "/api/attachments/holder.png"
        val cancelledPath = "/api/attachments/stranded.png"
        val holderEntered = CountDownLatch(1)
        val releaseHolder = CountDownLatch(1)
        val releaseCancelled = kotlinx.coroutines.CompletableDeferred<Unit>()
        val fetches = AtomicInteger(0)
        val store = AvatarImageStore(
            fetch = { bot ->
                fetches.incrementAndGet()
                if (bot.avatarUrl == slowPath) {
                    holderEntered.countDown()
                    check(releaseHolder.await(5, TimeUnit.SECONDS))
                    byteArrayOf(1)
                } else {
                    releaseCancelled.await()
                    byteArrayOf(2)
                }
            },
            decode = { null },
        )

        val cancelledLeader = launch(Dispatchers.Unconfined, CoroutineStart.UNDISPATCHED) {
            store.bytesFor(bot(id = "cancelled", avatarUrl = cancelledPath))
        }
        val stranded = async(Dispatchers.Unconfined, CoroutineStart.UNDISPATCHED) {
            store.bytesFor(bot(id = "stranded", avatarUrl = cancelledPath))
        }

        launch(Dispatchers.Default) { store.bytesFor(bot(id = "holder", avatarUrl = slowPath)) }
        assertTrue(holderEntered.await(5, TimeUnit.SECONDS))

        launch(Dispatchers.Unconfined, CoroutineStart.UNDISPATCHED) {
            store.bytesFor(bot(id = "holder-joiner", avatarUrl = slowPath))
            cancelledLeader.cancel()
        }

        releaseHolder.countDown()

        withTimeout(5_000) {
            assertNull(
                stranded.await(),
                "a cancelled leader must release the callers parked behind it",
            )
        }
        withTimeout(5_000) { cancelledLeader.join() }

        releaseCancelled.complete(Unit)
        val again = withTimeout(5_000) {
            store.bytesFor(bot(id = "later", avatarUrl = cancelledPath))
        }
        assertContentEquals(byteArrayOf(2), again, "the stale in-flight entry outlived its leader")
        assertEquals(3, fetches.get(), "holder, cancelled leader, and the retry — nothing else")
    }

    private fun bot(
        id: String = "avatar-bot",
        avatarUrl: String?,
    ): Bot = Bot(
        id = id,
        threadId = "thread-$id",
        name = "Scout",
        title = "",
        description = "",
        notifications = true,
        color = "green",
        unread = false,
        modelSelection = ModelSelection(instanceId = "local", model = "test"),
        createdAt = 0.0,
        avatarUrl = avatarUrl,
        avatarCrop = AvatarCrop.CIRCLE,
    )
}
