// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.openmausbot.companion.core.TokenStore
import java.security.KeyStoreException
import javax.crypto.AEADBadTagException
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Device-token storage is excluded from backup and transfer; Android Keystore material is not migratable.
// An unavailable or cancelled store read cannot establish that a credential is absent.
class KeystoreTokenStore(
    private val prefsProvider: () -> SharedPreferences,
    /** Where the Keystore work and the blocking disk I/O go; overridden in tests. */
    private val io: CoroutineContext = Dispatchers.IO,
) : TokenStore {
    constructor(context: Context) : this({ openPrefs(context.applicationContext) })

    private val prefs: SharedPreferences by lazy(prefsProvider)

    override suspend fun save(connectionId: String, token: String) {
        try {
            withContext(io) {
                check(prefs.edit().putString(key(connectionId), token).commit()) {
                    "The device token write did not land."
                }
            }
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            throw TokenStoreException(locked = isLocked(error), cause = error)
        }
    }

    override suspend fun read(connectionId: String): TokenStore.ReadResult {
        return try {
            val value = withContext(io) { prefs.getString(key(connectionId), null) }
            if (value == null) TokenStore.ReadResult.Missing
            else TokenStore.ReadResult.Found(value)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            TokenStore.ReadResult.Unavailable(
                locked = isLocked(error),
                message = error.message
                    ?: "Couldn't access the pairing securely.",
            )
        }
    }

    override suspend fun remove(connectionId: String) {
        try {
            withContext(io) { prefs.edit().remove(key(connectionId)).commit() }
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Exception) {
        }
    }

    private fun key(connectionId: String): String = "token.$connectionId"

    companion object {
        const val PREFS_NAME = "companion_device_token"

        fun openPrefs(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }

        private fun isLocked(error: Throwable): Boolean {
            val chain = generateSequence(error) { it.cause }.toList()
            return chain.any {
                it is KeyStoreException ||
                    it is AEADBadTagException ||
                    "User not authenticated" in (it.message.orEmpty()) ||
                    "keystore" in (it.message.orEmpty().lowercase()) &&
                    "locked" in (it.message.orEmpty().lowercase())
            }
        }
    }
}

class TokenStoreException(
    val locked: Boolean,
    cause: Throwable,
) : Exception(cause.message ?: "Couldn't access the pairing securely.", cause)
