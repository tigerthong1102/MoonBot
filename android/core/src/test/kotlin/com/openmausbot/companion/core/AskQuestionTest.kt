// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable

class AskQuestionTest {
    @Serializable
    private data class AnswerVector(val request: QuestionRequestCardData, val answers: List<List<String>>, val formatted: String)

    @Test
    fun `formatter matches canonical phone protocol including multiline boundaries`() {
        val text = checkNotNull(javaClass.getResourceAsStream("/question-answer-v1.json")).bufferedReader().use { it.readText() }
        val vectors = CompanionJson.decodeFromString<List<AnswerVector>>(text)
        assertTrue(vectors.size >= 4)
        for (vector in vectors) assertEquals(vector.formatted, AskQuestionAnswer.format(vector.request.questions, vector.answers))
    }

    @Test
    fun `custom false forbids free text beside options but never disables free-text-only questions`() {
        val option = AskQuestionOption("Only choice")
        assertFalse(AskQuestion("Choose", options = listOf(option), custom = false).allowsCustom)
        assertTrue(AskQuestion("Notes", custom = false).allowsCustom)
        val ask = card().copy(tool = "AskUserQuestion", allowKey = "must-not-grant")
        assertFalse(ask.isPermission)
        assertFalse(ask.shouldRememberPermission("Always allow"))
        assertEquals("answer", ask.responseBehavior("Always allow"))
    }

    private val payload = """
        {
          "title": "Your bot has a question",
          "subtitle": "Which model should Hazelnut run on by default?",
          "options": ["Claude Opus 5", "Gemini"],
          "requestId": "req-1",
          "questionRequest": {
            "version": 1,
            "questions": [
              {
                "question": "Which model should Hazelnut run on by default?",
                "header": "Model",
                "multiSelect": false,
                "options": [
                  {"label": "Claude Opus 5", "description": "What the bot had before."},
                  {"label": "Gemini"}
                ]
              },
              {
                "question": "Which stores may it order from?",
                "header": "Stores",
                "multiSelect": true,
                "options": [{"label": "Instamart"}, {"label": "Blinkit"}]
              }
            ]
          }
        }
    """.trimIndent()

    private fun card(json: String = payload): OptionCard =
        CompanionJson.decodeFromString(OptionCard.serializer(), json)

    @Test
    fun `decodes the model's questions and their options`() {
        val card = card()
        assertEquals(2, card.questions.size)
        assertEquals("Model", card.questions[0].header)
        assertEquals("Claude Opus 5", card.questions[0].options[0].label)
        assertEquals("What the bot had before.", card.questions[0].options[0].detail)
        assertEquals(null, card.questions[0].options[1].detail)
        assertFalse(card.questions[0].allowsMultiple)
        assertTrue(card.questions[1].allowsMultiple)
    }

    @Test
    fun `a structured ask is a question, so only an answer settles it`() {
        val card = card()



        assertFalse(card.isPermission)
        assertEquals("answer", OptionCard.responseBehavior("anything", card.isPermission))
    }

    @Test
    fun `an ordinary approval keeps the ordinary card`() {
        val approval = card(
            """{"title":"Approval needed","subtitle":"git push","options":["Allow","Deny"],
               "requestId":"req-2","tool":"Bash"}""",
        )
        assertTrue(approval.questions.isEmpty())
        assertTrue(approval.isPermission)
    }

    @Test
    fun `a question that offers no options still decodes`() {
        val sparse = card(
            """{"title":"t","subtitle":"s","options":[],"requestId":"r",
               "questionRequest":{"questions":[{"question":"Which account?"}]}}""",
        )
        assertEquals(emptyList(), sparse.questions[0].options)
        assertEquals("Question 1", sparse.questions[0].tabLabel(1))
    }

    @Test
    fun `decodes an agent-composed ask and tolerates unknown fields`() {
        val composed = card(
            """{"title":"t","subtitle":"s","options":[],"requestId":"r",
               "questionRequest":{"version":1,"origin":"output","futureField":true,
               "questions":[{"question":"Ship the release?","options":[{"label":"Ship now"}]}]}}""",
        )
        assertEquals("output", composed.questionRequest?.origin)
        assertEquals("Ship now", composed.questions[0].options[0].label)
        assertEquals(null, card().questionRequest?.origin)
    }

    @Test
    fun `formats the answer the model will read`() {
        val answer = AskQuestionAnswer.format(
            card().questions,
            listOf(listOf("Claude Opus 5"), listOf("Instamart", "Blinkit")),
        )
        assertEquals(
            """
            The user answered your questions.

            Q: Which model should Hazelnut run on by default?
            A: Claude Opus 5

            Q: Which stores may it order from?
            A: Instamart, Blinkit
            """.trimIndent(),
            answer,
        )
    }

    @Test
    fun `omits an unanswered question rather than implying one`() {
        val questions = card().questions
        assertEquals(
            "The user answered your questions.\n\n" +
                "Q: Which model should Hazelnut run on by default?\nA: Gemini",
            AskQuestionAnswer.format(questions, listOf(listOf("Gemini"), listOf("   "))),
        )
        assertEquals(
            "",
            AskQuestionAnswer.format(questions, listOf(emptyList(), emptyList())),
            "nothing answered means nothing is sent",
        )
    }

    @Test
    fun `a settled card drops the model-facing lead-in`() {
        val answer = AskQuestionAnswer.format(card().questions, listOf(listOf("Gemini"), listOf("Instamart")))
        assertFalse(AskQuestionAnswer.withoutPreamble(answer).startsWith(AskQuestionAnswer.PREAMBLE))
        assertTrue(AskQuestionAnswer.withoutPreamble(answer).startsWith("Q: "))
        assertEquals("Tea", AskQuestionAnswer.withoutPreamble("Tea"))
    }

    @Test
    fun `an answered question keeps the words it was answered with`() {
        val settled = card(
            """{"title":"t","subtitle":"s","options":[],"requestId":"r","answered":"answer",
               "answeredText":"The user answered your questions.\n\nQ: Which model?\nA: Gemini",
               "questionRequest":{"version":1,"questions":[{"question":"Which model?","options":[]}]}}""",
        )
        assertFalse(settled.isPending)
        assertEquals(
            "Q: Which model?\nA: Gemini",
            AskQuestionAnswer.withoutPreamble(settled.answeredText!!),
        )
    }
}
