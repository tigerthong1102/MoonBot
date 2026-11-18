// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

@Serializable
data class AskQuestionOption(
    val label: String,
    /**
     * The model's one-line gloss under the label. Named `detail` because
     * `description` collides with nothing here but reads as a Kotlin
     * `toString` hook to anyone arriving from the Swift twin.
     */
    @SerialName("description") val detail: String? = null,
)

@Serializable
data class AskQuestion(
    val question: String,
    /** The short tab label the model gave this question ("Schedule", "Model"). */
    val header: String? = null,
    val multiSelect: Boolean? = null,
    /**
     * A question with no options is still answerable — the card always offers
     * free text — so a missing list is empty, not a failure.
     */
    val options: List<AskQuestionOption> = emptyList(),
    val custom: Boolean? = null,
) {
    val allowsMultiple: Boolean get() = multiSelect == true
    val allowsCustom: Boolean get() = options.isEmpty() || custom != false

    /**
     * What the tab shows. The model names most questions; a numbered fallback
     * keeps the tabs distinguishable when it does not.
     */
    fun tabLabel(position: Int): String = header?.takeIf { it.isNotEmpty() } ?: "Question $position"
}

@Serializable
data class QuestionRequestCardData(
    val version: Int = 1,
    val questions: List<AskQuestion> = emptyList(),
    /**
     * Where the ask came from: a tool call (null) or a block the harness parsed
     * out of model-authored output ("output"). Badge data only — it never
     * changes how a card is answered.
     */
    val origin: String? = null,
)

object AskQuestionAnswer {
    /**
     * The lead-in exists for the model — the answer is delivered on the
     * permission contract's deny channel, so it has to say what it is. The
     * card strips it back off when it shows a person what they sent.
     */
    const val PREAMBLE = "The user answered your questions."

    fun format(questions: List<AskQuestion>, answers: List<List<String>>): String {
        val pairs = questions.mapIndexedNotNull { index, question ->
            val picked = answers.getOrElse(index) { emptyList() }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            if (picked.isEmpty()) null else listOf(question.question, picked.joinToString(", "))
        }
        if (pairs.isEmpty()) return ""
        if (pairs.any { pair -> pair.any { '\n' in it || '\r' in it } }) {
            val json = JsonArray(pairs.map { pair -> JsonArray(pair.map(::JsonPrimitive)) })
            return "$PREAMBLE\n\nAnswers (JSON):\n$json"
        }
        return "$PREAMBLE\n\n${pairs.joinToString("\n\n") { "Q: ${it[0]}\nA: ${it[1]}" }}"
    }

    /** The same answer without the model-facing lead-in, for a settled card. */
    fun withoutPreamble(answer: String): String {
        val lead = "$PREAMBLE\n\n"
        if (!answer.startsWith(lead)) return answer
        val content = answer.removePrefix(lead)
        val marker = "Answers (JSON):\n"
        if (!content.startsWith(marker)) return content
        return runCatching {
            val pairs = CompanionJson.decodeFromString<List<List<String>>>(content.removePrefix(marker))
            require(pairs.all { it.size == 2 })
            pairs.joinToString("\n\n") { "${it[0]}\n${it[1]}" }
        }.getOrDefault(content)
    }
}
