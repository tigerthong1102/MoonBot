// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.CompanionState
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewSectionSheet(onDismiss: () -> Unit) {
    val session = LocalCompanion.current.session
    val state by session.state.collectAsState()
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var name by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var saving by remember { mutableStateOf(false) }
    var lastCreated by remember { mutableStateOf<String?>(null) }
    val bots = remember(state) { SectionRules.selectable(state) }

    val trimmed = name.trim()
    val joinsExisting = remember(state, trimmed) { SectionRules.joinsExistingSection(state, trimmed) }
    val chiefConflict = remember(bots, selected, trimmed) {
        SectionRules.hasChiefConflict(bots, selected, trimmed)
    }
    val pinnedSelection = remember(bots, selected) { SectionRules.hasPinnedSelection(bots, selected) }

    val dismissGate = remember {
        { value: SheetValue -> value != SheetValue.Hidden || SectionRules.canDismiss(saving) }
    }
    val sheetState = rememberModalBottomSheetState(confirmValueChange = dismissGate)

    ModalBottomSheet(
        onDismissRequest = { if (SectionRules.canDismiss(saving)) onDismiss() },
        sheetState = sheetState,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                TextButton(
                    onClick = onDismiss,
                    enabled = SectionRules.canDismiss(saving),
                    modifier = Modifier.align(Alignment.CenterStart),
                ) {
                    Text(if (lastCreated == null) "Cancel" else "Done")
                }
                Text(
                    text = "Organize bots",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.Center),
                )
                TextButton(
                    enabled = SectionRules.canSave(name, selected, saving, chiefConflict),
                    onClick = {
                        saving = true
                        val section = trimmed
                        scope.launch {
                            val saved = session.assignSection(section, SectionRules.ids(bots, selected))
                            if (saved != null) {
                                haptics.play(HapticCue.SUCCESS)
                                lastCreated = section
                                selected = emptySet()
                                name = ""
                            }
                            saving = false
                        }
                    },
                    modifier = Modifier.align(Alignment.CenterEnd),
                ) {
                    Text("Save")
                }
            }

            lastCreated?.let { section ->
                SectionNote(
                    text = "$section is ready",
                    detail = "Choose more bots for another section, or tap Done.",
                    container = MaterialTheme.colorScheme.secondaryContainer,
                    content = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Section name") },
                isError = trimmed.length > SectionRules.MAX_NAME_LENGTH,
                supportingText = {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (joinsExisting) "Adds to existing section" else "Creates a new section",
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            text = "${trimmed.length}/${SectionRules.MAX_NAME_LENGTH}",
                            fontSize = 13.sp,
                            color = if (trimmed.length > SectionRules.MAX_NAME_LENGTH) {
                                MaterialTheme.colorScheme.error
                            } else {
                                secondaryTint
                            },
                        )
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            )

            if (chiefConflict) {
                SectionNote(
                    text = SectionRules.CHIEF_CONFLICT,
                    container = MaterialTheme.colorScheme.tertiaryContainer,
                    content = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
            if (pinnedSelection) {
                Text(
                    text = SectionRules.PINNED_STAY,
                    fontSize = 13.sp,
                    color = secondaryTint,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }

            Text(
                text = "Bots",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = secondaryTint,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            if (bots.size > SectionRules.MAX_BOTS) {
                Text(
                    text = if (selected.size == SectionRules.MAX_BOTS) {
                        SectionRules.AT_LIMIT
                    } else {
                        SectionRules.UNDER_LIMIT
                    },
                    fontSize = 12.sp,
                    color = secondaryTint,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
            LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                items(bots, key = { it.id }) { bot ->
                    BotPickRow(
                        bot = bot,
                        selected = bot.id in selected,
                        onToggle = {
                            val next = SectionRules.toggle(selected, bot.id)
                            if (next !== selected) {
                                selected = next
                                haptics.play(HapticCue.SELECT)
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionNote(
    text: String,
    container: Color,
    content: Color,
    detail: String? = null,
) {
    Surface(
        color = container,
        contentColor = content,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(text = text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            detail?.let { Text(text = it, fontSize = 12.sp) }
        }
    }
}

internal object SectionRules {
    const val MAX_BOTS = 100
    const val MAX_NAME_LENGTH = 60

    const val CHIEF_CONFLICT =
        "A section can have one Chief. Go back and choose one Chief, or use a section without one."

    const val PINNED_STAY = "Pinned bots stay in Pinned until you unpin them."

    const val AT_LIMIT = "100 selected — that’s the section limit."
    const val UNDER_LIMIT = "Choose up to 100 bots for one section."

    fun selectable(state: CompanionState): List<Bot> = state.bots.filter { it.hidden != true }

    fun ids(bots: List<Bot>, selected: Set<String>): List<String> =
        bots.mapNotNull { it.id.takeIf(selected::contains) }.take(MAX_BOTS)

    fun toggle(selected: Set<String>, id: String): Set<String> = when {
        id in selected -> selected - id
        selected.size >= MAX_BOTS -> selected
        else -> selected + id
    }

    fun existingSections(state: CompanionState): Set<String> =
        (selectable(state).mapNotNull { normalized(it.section) } + state.rooms.mapNotNull { normalized(it.section) })
            .toSet()

    fun joinsExistingSection(state: CompanionState, name: String): Boolean =
        normalized(name)?.let { it in existingSections(state) } == true

    fun hasChiefConflict(bots: List<Bot>, selected: Set<String>, name: String): Boolean {
        val selectedChiefs = bots.filter { it.id in selected && it.chiefOfStaff == true }.map(Bot::id)
        val incumbents = normalized(name)?.let { destination ->
            bots.filter { it.chiefOfStaff == true && normalized(it.section) == destination }.map(Bot::id)
        }.orEmpty()
        return (selectedChiefs + incumbents).toSet().size > 1
    }

    fun hasPinnedSelection(bots: List<Bot>, selected: Set<String>): Boolean =
        bots.any { it.id in selected && it.pinned == true && it.chiefOfStaff != true }

    fun canDismiss(saving: Boolean): Boolean = !saving

    fun canSave(name: String, selected: Set<String>, saving: Boolean, chiefConflict: Boolean): Boolean =
        !saving &&
            name.trim().length in 1..MAX_NAME_LENGTH &&
            selected.size in 1..MAX_BOTS &&
            !chiefConflict

    private fun normalized(section: String?): String? = section?.trim()?.takeIf(String::isNotEmpty)
}
