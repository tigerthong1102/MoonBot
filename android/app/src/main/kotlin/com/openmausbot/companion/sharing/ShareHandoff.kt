package com.openmausbot.companion.sharing

import com.openmausbot.companion.ui.ShareLoadException
import com.openmausbot.companion.ui.SharePolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Inbound share credentials must not enter persisted Activity task state. */
internal object ShareHandoff {
    suspend fun run(
        copy: () -> SharePayload,
        relaunch: () -> Unit,
        markFinishing: () -> Unit,
        deliver: (SharePayload) -> Unit,
    ) {
        val payload = withContext(Dispatchers.IO) {
            runCatching(copy).getOrElse { error ->
                SharePayload.Failed(
                    message = (error as? ShareLoadException)?.message
                        ?: SharePolicy.generic(),
                )
            }
        }
        relaunch()
        markFinishing()
        deliver(payload)
    }
}
