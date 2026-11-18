// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.text.BreakIterator
import java.util.Locale

sealed interface TranscriptCard {
    data class Diff(
        val filename: String,
        val text: String,
        val lines: List<String>,
        val additions: Int,
        val deletions: Int,
    ) : TranscriptCard {
        val isTruncated: Boolean get() = lines.size > PREVIEW_LINES

        fun visibleLines(showingAll: Boolean): List<String> =
            if (showingAll) lines else lines.take(PREVIEW_LINES)

        companion object {
            const val PREVIEW_LINES: Int = 80
        }
    }

    data class Table(
        val headers: List<String>,
        val rows: List<List<String>>,
    ) : TranscriptCard {
        fun csv(): String = Csv.of(listOf(headers) + rows)
    }
}

object TranscriptCards {
    fun of(message: Message): TranscriptCard? {
        if (message.role == Message.Role.USER) return null
        val text = message.text ?: return null
        return diff(text) ?: table(text)
    }

    fun diff(source: String): TranscriptCard.Diff? {
        val text = source.trim()
        val patch = when {
            text.startsWith(DIFF_FENCE) && text.endsWith(FENCE) ->
                text.drop(DIFF_FENCE.length).dropLast(FENCE.length).trim()

            text.startsWith(GIT_HEADER) -> text

            else -> return null
        }
        val lines = patch.split("\n")
        val additions = lines.count { it.startsWith("+") && !it.startsWith("+++") }
        val deletions = lines.count { it.startsWith("-") && !it.startsWith("---") }
        return TranscriptCard.Diff(
            filename = filename(lines.firstOrNull().orEmpty()),
            text = patch,
            lines = lines,
            additions = additions,
            deletions = deletions,
        )
    }

    private fun filename(firstLine: String): String =
        firstLine.split(' ').lastOrNull { it.isNotEmpty() }?.replace("b/", "") ?: GIT_PATCH

    fun table(source: String): TranscriptCard.Table? {
        val lines = source.lines().map(String::trim).filter(String::isNotEmpty)
        if (lines.size < MINIMUM_TABLE_LINES) return null
        if (!lines.all { it.startsWith("|") && it.endsWith("|") }) return null

        val headers = cells(lines[0])
        if (headers.isEmpty()) return null
        val separators = cells(lines[1])
        if (separators.size != headers.size) return null
        if (!separators.all(::isSeparator)) return null

        val rows = lines.drop(2).map(::cells)
        if (!rows.all { it.size == headers.size }) return null
        return TranscriptCard.Table(headers, rows)
    }

    fun cells(line: String): List<String> {
        var body = line
        if (body.firstOrNull() == '|') body = body.substring(1)
        if (body.lastOrNull() == '|') body = body.dropLast(1)

        val out = ArrayList<String>()
        val cell = StringBuilder()
        var escaped = false
        for (character in body) {
            when {
                escaped -> {
                    if (character != '|') cell.append('\\')
                    cell.append(character)
                    escaped = false
                }

                character == '\\' -> escaped = true
                character == '|' -> {
                    out += cell.toString().trim()
                    cell.setLength(0)
                }

                else -> cell.append(character)
            }
        }
        if (escaped) cell.append('\\')
        out += cell.toString().trim()
        return out
    }

    private fun isSeparator(cell: String): Boolean {
        val core = cell.replace(" ", "").trim(':')
        return core.length >= MINIMUM_SEPARATOR_HYPHENS && core.all { it == '-' }
    }

    private const val DIFF_FENCE = "```diff"
    private const val FENCE = "```"
    private const val GIT_HEADER = "diff --git "
    private const val GIT_PATCH = "Git patch"
    private const val MINIMUM_TABLE_LINES = 3
    private const val MINIMUM_SEPARATOR_HYPHENS = 3
}

/**
 * RFC 4180 quoting. Android keeps this helper; the iOS SQL card is gone and
 * the phone now draws a markdown table (issue 1707). A field is left alone
 * unless it carries a separator, a quote or a
 * line break, and a quote inside a quoted field is doubled. Getting this wrong
 * does not look wrong — it looks like a spreadsheet with the columns shifted.
 */
object Csv {
    fun of(rows: List<List<String>>): String =
        rows.joinToString("\n") { row -> row.joinToString(",", transform = ::field) }

    fun field(value: String): String {
        if (value.none { it == ',' || it == '"' || it == '\n' || it == '\r' }) return value
        return "\"" + value.replace("\"", "\"\"") + "\""
    }
}

/**
 * The last [count] characters the way Swift counts them.
 *
 * `String.suffix(n)` there walks `Character`s — extended grapheme clusters — so
 * it can never begin a tail halfway through one, and an emoji costs it one, not
 * two. `takeLast` counts UTF-16 code units, which both shortens the tail
 * wherever the text is not ASCII and can start it on the low half of a surrogate
 * pair or on a combining mark whose base it just dropped.
 *
 * Java's `BreakIterator` implements an older UAX #29 than the ICU on a device,
 * so the two agree on surrogate pairs and combining marks but not necessarily on
 * flags or ZWJ sequences. That is a difference in how many clusters a rare
 * emoji costs, never in leaving one broken — which is what the cut is for.
 */
fun String.takeLastCharacters(count: Int): String {
    if (length <= count) return this
    val clusters = BreakIterator.getCharacterInstance(Locale.ROOT)
    clusters.setText(this)
    var start = clusters.last()
    var taken = 0
    while (taken < count) {
        val previous = clusters.previous()
        if (previous == BreakIterator.DONE) break
        start = previous
        taken++
    }
    return substring(start)
}

object Reasoning {
    const val VISIBLE_CHARACTERS: Int = 2_000

    fun visible(reasoning: String): String = reasoning.takeLastCharacters(VISIBLE_CHARACTERS)

    fun steps(reasoning: String): List<String> =
        visible(reasoning).split("\n").filter(String::isNotBlank)
}
