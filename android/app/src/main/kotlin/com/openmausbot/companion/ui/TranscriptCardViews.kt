// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R
import com.openmausbot.companion.core.Reasoning
import com.openmausbot.companion.core.TranscriptCard
import java.util.Locale
import kotlinx.coroutines.launch



private const val CARD_CLIP_LABEL = "StartupBot card"

private val DiffAdded = Color(MausPalette.argb("green"))
private val DiffRemoved = Color(MausPalette.argb("red"))
private val DiffHunk = Color(MausPalette.argb("cyan"))

@Composable
fun DiffCard(card: TranscriptCard.Diff, modifier: Modifier = Modifier) {
    var showingDiff by rememberSaveable(card.text) { mutableStateOf(true) }
    var showingAll by rememberSaveable(card.text) { mutableStateOf(false) }
    val copy = rememberCopy()
    val haptics = rememberHaptics()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = card.filename,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            Row(
                modifier = Modifier
                    .background(secondaryTint.copy(alpha = 0.14f), CircleShape)
                    .padding(horizontal = 8.dp, vertical = 3.dp)
                    .semantics(mergeDescendants = true) {
                        contentDescription =
                            "${card.additions} lines added, ${card.deletions} removed"
                    },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "+${card.additions}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = DiffAdded,
                )
                Text(
                    text = "-${card.deletions}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = DiffRemoved,
                )
            }
        }

        if (card.text.isNotEmpty()) {
            Disclosure(
                expanded = showingDiff,
                label = if (showingDiff) stringResource(R.string.ui_hide_diff) else stringResource(R.string.ui_view_diff),
                onToggle = {
                    haptics.play(HapticCue.SELECT)
                    showingDiff = !showingDiff
                },
            )

            if (showingDiff) {
                val lines = remember(card, showingAll) { card.visibleLines(showingAll) }
                SelectionContainer {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                secondaryTint.copy(alpha = 0.10f),
                                RoundedCornerShape(10.dp),
                            )
                            .horizontalScroll(rememberScrollState())
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(1.dp),
                    ) {
                        lines.forEach { DiffLine(it) }
                    }
                }

                if (card.isTruncated) {
                    val label = if (showingAll) {
                        "Show first ${TranscriptCard.Diff.PREVIEW_LINES} lines"
                    } else {
                        "Show all ${card.lines.size} lines"
                    }
                    TextButton(
                        onClick = {
                            haptics.play(HapticCue.SELECT)
                            showingAll = !showingAll
                        },
                        modifier = Modifier.semantics {
                            contentDescription =
                                "$label. The copied diff always includes every line"
                        },
                    ) {
                        Text(label, fontSize = 13.sp)
                    }
                }
            }
        }

        HorizontalDivider(color = secondaryTint.copy(alpha = 0.2f))

        TextButton(onClick = { copy(card.text) }) {
            Text(stringResource(R.string.ui_copy_diff), fontSize = 13.sp)
        }
    }
}

@Composable
private fun DiffLine(line: String) {
    val added = line.startsWith("+") && !line.startsWith("+++")
    val removed = line.startsWith("-") && !line.startsWith("---")
    val hunk = line.startsWith("@@") || line.startsWith("diff")
    Text(
        text = line,
        fontSize = 12.sp,
        fontFamily = FontFamily.Monospace,
        softWrap = false,
        color = when {
            added -> DiffAdded
            removed -> DiffRemoved
            hunk -> DiffHunk
            else -> MaterialTheme.colorScheme.onSurface
        },
        modifier = Modifier
            .background(
                when {
                    added -> DiffAdded.copy(alpha = 0.14f)
                    removed -> DiffRemoved.copy(alpha = 0.14f)
                    else -> Color.Transparent
                },
                RoundedCornerShape(3.dp),
            )
            .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

@Composable
fun DataTableCard(card: TranscriptCard.Table, modifier: Modifier = Modifier) {
    val copy = rememberCopy()
    val scroll = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.ui_data_table),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = if (card.rows.size == 1) stringResource(R.string.ui_1_row) else stringResource(R.string.ui_rows, card.rows.size),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = secondaryTint,
                modifier = Modifier
                    .background(secondaryTint.copy(alpha = 0.14f), CircleShape)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }

        SelectionContainer {
            DataGrid(
                headers = card.headers,
                rows = card.rows,
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(scroll),
            )
        }

        HorizontalDivider(color = secondaryTint.copy(alpha = 0.2f))

        TextButton(onClick = { copy(card.csv()) }) {
            Text(stringResource(R.string.ui_copy_csv), fontSize = 13.sp)
        }
    }
}

@Composable
private fun DataGrid(
    headers: List<String>,
    rows: List<List<String>>,
    modifier: Modifier = Modifier,
) {
    if (headers.isEmpty()) return
    val ruleColour = secondaryTint.copy(alpha = 0.25f)
    Layout(
        modifier = modifier,
        content = {
            headers.forEach { header ->
                Text(
                    text = header.uppercase(Locale.ROOT),
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    softWrap = false,
                )
            }
            repeat(headers.size) {
                HorizontalDivider(color = ruleColour)
            }
            rows.forEach { row ->
                headers.indices.forEach { column ->
                    Text(
                        text = row.getOrElse(column) { "" },
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Monospace,
                        softWrap = false,
                    )
                }
            }
        },
        measurePolicy = tableGridMeasurePolicy(columnCount = headers.size),
    )
}

private val TABLE_MIN_COLUMN_WIDTH = 64.dp

private val TABLE_COLUMN_GAP = 18.dp
private val TABLE_ROW_GAP = 4.dp

internal fun tableGridMeasurePolicy(
    columnCount: Int,
    minColumnWidth: Dp = TABLE_MIN_COLUMN_WIDTH,
    columnGap: Dp = TABLE_COLUMN_GAP,
    rowGap: Dp = TABLE_ROW_GAP,
): MeasurePolicy = MeasurePolicy { measurables, constraints ->
    require(columnCount > 0) { "a table with no columns has nothing to lay out" }
    val rowCount = (measurables.size - columnCount * 2) / columnCount
    val unbounded = Constraints()
    val headings = List(columnCount) { measurables[it].measure(unbounded) }
    val cells = List(rowCount * columnCount) {
        measurables[columnCount * 2 + it].measure(unbounded)
    }

    val floor = minColumnWidth.roundToPx()
    val widths = IntArray(columnCount) { column ->
        var widest = maxOf(floor, headings[column].width)
        for (row in 0 until rowCount) {
            widest = maxOf(widest, cells[row * columnCount + column].width)
        }
        widest
    }
    val rules = List(columnCount) {
        measurables[columnCount + it].measure(Constraints.fixedWidth(widths[it]))
    }

    val gutter = columnGap.roundToPx()
    val leading = rowGap.roundToPx()
    val x = IntArray(columnCount)
    var pen = 0
    for (column in 0 until columnCount) {
        x[column] = pen
        pen += widths[column] + gutter
    }
    val width = pen - gutter

    val headingHeight = headings.maxOf { it.height }
    val ruleY = headingHeight + leading
    val y = IntArray(rowCount)
    var baseline = ruleY + rules.maxOf { it.height }
    for (row in 0 until rowCount) {
        baseline += leading
        y[row] = baseline
        baseline += (0 until columnCount).maxOf { cells[row * columnCount + it].height }
    }

    layout(constraints.constrainWidth(width), constraints.constrainHeight(baseline)) {
        headings.forEachIndexed { column, heading -> heading.placeRelative(x[column], 0) }
        rules.forEachIndexed { column, rule -> rule.placeRelative(x[column], ruleY) }
        cells.forEachIndexed { index, cell ->
            cell.placeRelative(x[index % columnCount], y[index / columnCount])
        }
    }
}

@Composable
fun ThoughtChamber(
    reasoning: String,
    modifier: Modifier = Modifier,
    streaming: Boolean = true,
) {
    val steps = remember(reasoning) { Reasoning.steps(reasoning) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    val haptics = rememberHaptics()

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .background(secondaryTint.copy(alpha = 0.12f), CircleShape)
                .clickable(
                    role = Role.Button,
                    onClickLabel = if (expanded) "Collapse" else "Expand",
                    onClick = {
                        haptics.play(HapticCue.SELECT)
                        expanded = !expanded
                    },
                )
                .semantics {
                    stateDescription = if (expanded) "Expanded" else "Collapsed"
                }
                .padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_sparkles),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(16.dp),
            )
            Text(
                text = if (streaming) stringResource(R.string.ui_thinking) else stringResource(R.string.ui_thought_process),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = if (steps.size == 1) stringResource(R.string.ui_1_step) else stringResource(R.string.ui_steps, steps.size),
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = secondaryTint,
            )
            Icon(
                imageVector = if (expanded) {
                    Icons.Filled.KeyboardArrowUp
                } else {
                    Icons.Filled.KeyboardArrowDown
                },
                contentDescription = null,
                tint = secondaryTint,
                modifier = Modifier.size(18.dp),
            )
        }

        if (expanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        secondaryTint.copy(alpha = 0.08f),
                        RoundedCornerShape(12.dp),
                    )
                    .heightIn(max = CHAMBER_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                steps.forEachIndexed { index, step ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "${index + 1}.",
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(text = step, fontSize = 13.sp, color = secondaryTint)
                    }
                }
            }
        }
    }
}

@Composable
private fun Disclosure(expanded: Boolean, label: String, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MIN_TOUCH_TARGET)
            .clip(RoundedCornerShape(8.dp))
            .clickable(
                role = Role.Button,
                onClickLabel = if (expanded) "Collapse" else "Expand",
                onClick = onToggle,
            )
            .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (expanded) {
                Icons.Filled.KeyboardArrowDown
            } else {
                Icons.AutoMirrored.Filled.KeyboardArrowRight
            },
            contentDescription = null,
            tint = secondaryTint,
            modifier = Modifier.size(18.dp),
        )
        Text(text = label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = secondaryTint)
    }
}

internal class CardClipboard(
    private val write: (String) -> Unit,
    private val haptics: Haptics,
) {
    operator fun invoke(text: String) {
        write(text)
        haptics.play(HapticCue.SELECT)
    }
}

@Composable
private fun rememberCopy(): CardClipboard {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    return remember(clipboard, scope, haptics) {
        CardClipboard(
            write = { text ->
                scope.launch {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(CARD_CLIP_LABEL, text)))
                }
                Unit
            },
            haptics = haptics,
        )
    }
}

private val CHAMBER_HEIGHT = 180.dp
