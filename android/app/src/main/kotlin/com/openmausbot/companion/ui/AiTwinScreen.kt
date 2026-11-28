package com.openmausbot.companion.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.openmausbot.companion.R
import com.openmausbot.companion.core.AiTwinAction
import com.openmausbot.companion.core.AiTwinAnswer
import com.openmausbot.companion.core.AiTwinStatus

@Composable
internal fun AiTwinScreen(onBack: () -> Unit) {
    val session = LocalCompanion.current.session
    var status by remember { mutableStateOf<AiTwinStatus?>(null) }
    var resumed by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var retry by remember { mutableStateOf(0) }
    var question by remember { mutableStateOf("") }
    var action by remember { mutableStateOf<AiTwinAction?>(null) }
    var answer by remember { mutableStateOf<AiTwinAnswer?>(null) }
    var failed by remember { mutableStateOf(false) }

    BackHandler(onBack = onBack)
    LifecycleResumeEffect(Unit) {
        resumed = true
        onPauseOrDispose {
            resumed = false
            status = null
            question = ""
            action = null
            answer = null
        }
    }
    LaunchedEffect(resumed, retry) {
        if (!resumed) return@LaunchedEffect
        loading = true
        answer = null
        status = session.aiTwin()
        loading = false
        failed = false
    }
    val twin = status?.twin
    val provider = status?.preview
    LaunchedEffect(action) {
        val requested = action ?: return@LaunchedEffect
        val profile = twin ?: return@LaunchedEffect
        answer = null
        failed = false
        answer = session.askAiTwin(profile, question, requested, provider)
        failed = answer == null
        action = null
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            HeaderBackButton(onBack)
            Text(stringResource(R.string.ai_twin_title), style = MaterialTheme.typography.titleLarge)
        }
        if (loading) {
            CircularProgressIndicator()
        } else if (twin == null || twin.paused) {
            Text(stringResource(if (twin?.paused == true) R.string.ai_twin_paused else R.string.ai_twin_unavailable))
            Button(onClick = { retry += 1 }) { Text(stringResource(R.string.ai_twin_refresh)) }
        } else {
            Text(twin.name, style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = question,
                onValueChange = { if (it.length <= 1_000) { question = it; answer = null } },
                enabled = action == null,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.ai_twin_question)) },
            )
            val enabled = question.isNotBlank() && action == null
            Button(enabled = enabled, onClick = { action = AiTwinAction.Exact }) { Text(stringResource(R.string.ai_twin_lookup)) }
            if (provider != null) {
                Button(enabled = enabled, onClick = { action = AiTwinAction.Semantic }) { Text(stringResource(R.string.ai_twin_semantic)) }
                Button(enabled = enabled, onClick = { action = AiTwinAction.Draft }) { Text(stringResource(R.string.ai_twin_draft)) }
                Text(stringResource(R.string.ai_twin_disclosure, provider.name, provider.model), style = MaterialTheme.typography.bodySmall)
            }
            if (action != null) CircularProgressIndicator()
            if (failed) {
                Text(stringResource(R.string.ai_twin_failed))
                Button(onClick = { retry += 1 }) { Text(stringResource(R.string.ai_twin_refresh)) }
            }
            answer?.let { result ->
                val lesson = result.lesson
                if (lesson != null) {
                    Text(stringResource(if (result.match == "semantic") R.string.ai_twin_match else R.string.ai_twin_approved))
                    Text(lesson.question, style = MaterialTheme.typography.titleSmall)
                    SelectionContainer { Text(lesson.answer) }
                } else if (result.draft == null) {
                    Text(stringResource(R.string.ai_twin_missing))
                }
                result.draft?.let { draft ->
                    Text(stringResource(R.string.ai_twin_private_draft), style = MaterialTheme.typography.titleSmall)
                    SelectionContainer { Text(draft) }
                }
            }
        }
    }
}
