package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class StartupBotCompatibilityTest {
    @Test fun ownAndLegacySchemesRetainPairingValidation() {
        for (scheme in listOf("startupbot", "openmausbot")) {
            val invite = assertNotNull(PairingInvite.parse("$scheme://pair?address=192.168.1.20%3A8810&code=123456"))
            assertEquals("123456", invite.credential)
            assertNull(PairingInvite.parse("$scheme://other?address=192.168.1.20%3A8810&code=123456"))
            assertNull(PairingInvite.parse("$scheme://pair?address=192.168.1.20%3A8810&code=123456&code=654321"))
        }
    }
}
