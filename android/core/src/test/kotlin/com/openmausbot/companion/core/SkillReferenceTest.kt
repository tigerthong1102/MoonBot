package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFails

class SkillReferenceTest {
    private fun proposal() = CompanionJson.decodeFromString<SkillRequestCardData>(
        """{"version":1,"requestId":"r","botId":"b","threadId":"t","stagedId":"s","action":"create","name":"Fixture","gist":"Fixture","preview":"SKILL.md content","sha256":"${"a".repeat(64)}","warnings":[],"createdAt":1,"references":[{"path":"references/rules.md","content":"Sensitive reference instructions"}],"referencesSha256":"${"b".repeat(64)}"}""",
    )

    @Test
    fun completeReferencePayloadIsAvailableForReview() {
        val proposal = proposal()
        assertEquals("Sensitive reference instructions", proposal.references?.single()?.content)
        assertEquals("references/rules.md", proposal.references?.single()?.path)
        assertEquals("a".repeat(64), proposal.reviewedSha256)
    }

    @Test
    fun incompleteOrMalformedReferencesAreDenyOnly() {
        val proposal = proposal()
        assertNull(proposal.copy(references = null).reviewedSha256)
        assertNull(proposal.copy(referencesSha256 = null).reviewedSha256)
        assertNull(proposal.copy(referencesSha256 = "invalid").reviewedSha256)
        assertNull(proposal.copy(references = proposal.references!! + proposal.references!!).reviewedSha256)
        assertNull(proposal.copy(references = listOf(SkillReferenceFile("../hidden", "bad"))).reviewedSha256)
        assertEquals("a".repeat(64), proposal.copy(references = null, referencesSha256 = null).reviewedSha256)
        assertFails { CompanionJson.decodeFromString<SkillReferenceFile>("""{"path":"references/rules.md"}""") }
    }
}
