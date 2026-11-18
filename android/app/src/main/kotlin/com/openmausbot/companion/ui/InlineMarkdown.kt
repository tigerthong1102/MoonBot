// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

data class InlineSpan(
    val text: String,
    val styles: Set<InlineStyle> = emptySet(),
    val link: String? = null,
)

enum class InlineStyle { BOLD, ITALIC, CODE, STRIKE }

/**
 * The inline half of markdown, in-house.
 *
 * `Markdown.blocks` (`:core`) already split the source into paragraphs, headings,
 * list items, quotes and fences; this walks one block's text and produces styled
 * runs. iOS hands the same job to Foundation
 * (`AttributedString(markdown:options:.inlineOnlyPreservingWhitespace)`), whose
 * supported set is bold, italic, code spans, strikethrough and links — so that is
 * exactly the set understood here. Markwon would be a 300KB dependency and a
 * second block parser competing with `:core`'s.
 *
 * Two rules matter more than completeness, because this renders a reply while it
 * is still being typed:
 *
 * - An **unterminated** marker is literal text. A half-written `[label](` shows
 *   the characters the model has sent so far rather than vanishing until the
 *   bracket closes.
 * - Code-span content is never re-parsed, so a snippet full of `*` stays a
 *   snippet.
 */
object InlineMarkdown {

    fun parse(source: String): List<InlineSpan> =
        merge(render(source, emptySet(), null))

    fun plain(spans: List<InlineSpan>): String = spans.joinToString("") { it.text }

    private fun render(source: String, styles: Set<InlineStyle>, link: String?): List<InlineSpan> {
        val out = mutableListOf<InlineSpan>()
        val buffer = StringBuilder()
        var index = 0

        fun flush() {
            if (buffer.isEmpty()) return
            out += InlineSpan(buffer.toString(), styles, link)
            buffer.setLength(0)
        }

        while (index < source.length) {
            val character = source[index]

            if (character == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE) {
                buffer.append(source[index + 1])
                index += 2
                continue
            }

            if (character == '`') {
                val fence = runLength(source, index, '`')
                val close = findCodeClose(source, index + fence, fence)
                if (close >= 0) {
                    flush()
                    out += InlineSpan(
                        stripCodeSpacing(source.substring(index + fence, close)),
                        styles + InlineStyle.CODE,
                        link,
                    )
                    index = close + fence
                    continue
                }
                buffer.append(character)
                index += 1
                continue
            }

            if (character == '~' && runLength(source, index, '~') >= 2) {
                val close = findRun(source, index + 2, '~', 2)
                if (close > index + 2) {
                    flush()
                    out += render(source.substring(index + 2, close), styles + InlineStyle.STRIKE, link)
                    index = close + 2
                    continue
                }
                buffer.append(character)
                index += 1
                continue
            }

            if (character == '*' || character == '_') {
                val run = runLength(source, index, character)
                val width = minOf(run, 3)
                val opensHere = character == '*' || !isWordCharacter(source.getOrNull(index - 1))
                val closeStart = if (opensHere) {
                    findEmphasisClose(source, index + width, character, width)
                } else {
                    -1
                }
                val close = if (closeStart < 0) {
                    -1
                } else {
                    closeStart + (runLength(source, closeStart, character) - width)
                }
                if (close >= index + width) {
                    val inner = source.substring(index + width, close)
                    if (inner.isNotEmpty()) {
                        flush()
                        out += render(inner, styles + emphasisStyles(width), link)
                        index = close + width
                        continue
                    }
                }
                buffer.append(character)
                index += 1
                continue
            }

            if (character == '[') {
                val labelEnd = findLabelClose(source, index + 1)
                if (labelEnd >= 0 && source.getOrNull(labelEnd + 1) == '(') {
                    val tail = parseLinkTail(source, labelEnd + 2)
                    if (tail != null) {
                        flush()
                        out += render(source.substring(index + 1, labelEnd), styles, tail.destination)
                        index = tail.end + 1
                        continue
                    }
                }
                buffer.append(character)
                index += 1
                continue
            }

            buffer.append(character)
            index += 1
        }

        flush()
        return out
    }

    private fun emphasisStyles(width: Int): Set<InlineStyle> = when (width) {
        1 -> setOf(InlineStyle.ITALIC)
        2 -> setOf(InlineStyle.BOLD)
        else -> setOf(InlineStyle.BOLD, InlineStyle.ITALIC)
    }

    private fun merge(spans: List<InlineSpan>): List<InlineSpan> {
        val out = mutableListOf<InlineSpan>()
        for (span in spans) {
            if (span.text.isEmpty()) continue
            val last = out.lastOrNull()
            if (last != null && last.styles == span.styles && last.link == span.link) {
                out[out.lastIndex] = last.copy(text = last.text + span.text)
            } else {
                out += span
            }
        }
        return out
    }

    private fun runLength(source: String, from: Int, character: Char): Int {
        var length = 0
        while (from + length < source.length && source[from + length] == character) length += 1
        return length
    }

    private fun findCodeClose(source: String, from: Int, fence: Int): Int {
        var index = from
        while (index < source.length) {
            if (source[index] == '`') {
                val run = runLength(source, index, '`')
                if (run == fence) return index
                index += run
                continue
            }
            index += 1
        }
        return -1
    }

    private fun findRun(source: String, from: Int, character: Char, width: Int): Int {
        var index = from
        while (index < source.length) {
            val current = source[index]
            if (current == '\\' && index + 1 < source.length) {
                index += 2
                continue
            }
            if (current == '`') {
                val fence = runLength(source, index, '`')
                val close = findCodeClose(source, index + fence, fence)
                index = if (close >= 0) close + fence else index + fence
                continue
            }
            if (current == character) {
                val run = runLength(source, index, character)
                if (run >= width) return index
                index += run
                continue
            }
            index += 1
        }
        return -1
    }

    private fun findEmphasisClose(source: String, from: Int, character: Char, width: Int): Int {
        var search = from
        while (search < source.length) {
            val at = findRun(source, search, character, width)
            if (at < 0) return -1
            val closesHere = character == '*' ||
                !isWordCharacter(source.getOrNull(at + runLength(source, at, character)))
            if (closesHere) return at
            search = at + runLength(source, at, character)
        }
        return -1
    }

    private fun isWordCharacter(character: Char?): Boolean =
        character != null && (character.isLetterOrDigit() || character == '_')

    private fun findLabelClose(source: String, from: Int): Int {
        var depth = 0
        var index = from
        while (index < source.length) {
            val current = source[index]
            if (current == '`') {
                val fence = runLength(source, index, '`')
                val close = findCodeClose(source, index + fence, fence)
                index = if (close >= 0) close + fence else index + fence
                continue
            }
            when {
                current == '\\' && index + 1 < source.length -> index += 1
                current == '[' -> depth += 1
                current == ']' -> {
                    if (depth == 0) return index
                    depth -= 1
                }
            }
            index += 1
        }
        return -1
    }


    private data class LinkTail(val destination: String, val end: Int)

    private fun parseLinkTail(source: String, from: Int): LinkTail? {
        var index = skipSeparators(source, from) ?: return null
        val destination: String

        if (index < source.length && source[index] == '<') {
            var scan = index + 1
            var close = -1
            while (scan < source.length) {
                val current = source[scan]
                if (current == '<' || isLineEnding(current)) return null
                if (current == '\\' &&
                    scan + 1 < source.length &&
                    source[scan + 1] in ESCAPABLE
                ) {
                    scan += 2
                    continue
                }
                if (current == '>') {
                    close = scan
                    break
                }
                scan += 1
            }
            if (close < 0) return null
            destination = unescape(source.substring(index + 1, close))
            index = close + 1
        } else {
            val start = index
            var depth = 0
            loop@ while (index < source.length) {
                val current = source[index]
                when {
                    current == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE ->
                        index += 2
                    isSeparator(current) || isLineEnding(current) -> break@loop
                    isControl(current) -> return null
                    current == '(' -> {
                        depth += 1
                        index += 1
                    }
                    current == ')' -> {
                        if (depth == 0) break@loop
                        depth -= 1
                        index += 1
                    }
                    else -> index += 1
                }
            }
            if (depth != 0) return null
            destination = unescape(source.substring(start, index))
        }

        val afterDestination = index
        index = skipSeparators(source, index) ?: return null
        if (index > afterDestination && index < source.length && source[index] in TITLE_OPENERS) {
            index = titleEnd(source, index) ?: return null
        }
        index = skipSeparators(source, index) ?: return null
        return if (index < source.length && source[index] == ')') {
            LinkTail(destination, index)
        } else {
            null
        }
    }

    private fun titleEnd(source: String, from: Int): Int? {
        val open = source[from]
        val close = if (open == '(') ')' else open
        var index = from + 1
        while (index < source.length) {
            val current = source[index]
            if (current == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE) {
                index += 2
                continue
            }
            if (current == close) return index + 1
            if (open == '(' && current == '(') return null
            index += 1
        }
        return null
    }

    private fun skipSeparators(source: String, from: Int): Int? {
        var index = from
        var lineEndings = 0
        while (index < source.length) {
            val current = source[index]
            when {
                isSeparator(current) -> index += 1
                current == '\r' -> {
                    lineEndings += 1
                    index += 1
                    if (index < source.length && source[index] == '\n') index += 1
                }
                current == '\n' -> {
                    lineEndings += 1
                    index += 1
                }
                else -> return if (lineEndings > 1) null else index
            }
        }
        return if (lineEndings > 1) null else index
    }

    private fun isSeparator(character: Char): Boolean = character == ' ' || character == '\t'

    private fun isLineEnding(character: Char): Boolean = character == '\n' || character == '\r'

    private fun isControl(character: Char): Boolean =
        character.code < 0x20 || character.code == 0x7F

    private val TITLE_OPENERS = setOf('"', '\'', '(')


    private fun unescape(source: String): String {
        if ('\\' !in source) return source
        val out = StringBuilder(source.length)
        var index = 0
        while (index < source.length) {
            val current = source[index]
            if (current == '\\' && index + 1 < source.length && source[index + 1] in ESCAPABLE) {
                out.append(source[index + 1])
                index += 2
                continue
            }
            out.append(current)
            index += 1
        }
        return out.toString()
    }

    private fun stripCodeSpacing(raw: String): String {
        if (raw.length >= 2 && raw.first() == ' ' && raw.last() == ' ' && raw.isNotBlank()) {
            return raw.substring(1, raw.length - 1)
        }
        return raw
    }

    private val ESCAPABLE: Set<Char> =
        "\\`*_{}[]()#+-.!|~<>\"'$%&,/:;=?@^".toSet()
}
