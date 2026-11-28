// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.R


object OnboardingCopy {
    const val WELCOME_TITLE = "Welcome to StartupBot"
    const val WELCOME_SUBTITLE =
        "Open chats, approve actions, and send new work from your phone."
    const val WELCOME_CONNECT = "Connect my computer"
    const val NOT_NOW = "Not now"

    const val UNPAIRED_HOME_TITLE = "Connect when you're ready"
    const val UNPAIRED_HOME_BODY =
        "Pair this phone with StartupBot to see your chats and respond to your bots."
    const val UNPAIRED_HOME_HINT =
        "On your computer, open StartupBot → Settings → Phone."
    const val UNPAIRED_HOME_CONNECT = "Connect computer"

    const val NOTIFICATIONS_TITLE = "Stay in the loop"


    const val NOTIFICATIONS_BODY = SettingsPolicy.NOTIFICATIONS_FOOTER
    const val NOTIFICATIONS_APPROVALS = "Approvals that are waiting for you"
    const val NOTIFICATIONS_FINISHED = "Finished work and important updates"
    const val NOTIFICATIONS_ENABLE = "Enable notifications"
}

@Composable
fun WelcomeScreen(onConnect: () -> Unit, onSkip: () -> Unit) {
    OnboardingLayout(
        actions = {
            MobileChatButton()
            Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.ui_onboardingcopy_welcome_connect))
            }
            TextButton(onClick = onSkip, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.ui_not_now))
            }
        },
    ) {
        androidx.compose.foundation.Image(
            painter = androidx.compose.ui.res.painterResource(com.openmausbot.companion.R.drawable.startupbot_logo),
            contentDescription = stringResource(R.string.ui_startupbot),
            modifier = Modifier.size(88.dp),
        )
        Text(
            text = stringResource(R.string.ui_onboardingcopy_welcome_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(R.string.ui_onboardingcopy_welcome_subtitle),
            style = MaterialTheme.typography.bodyLarge,
            color = secondaryTint,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Benefit(
            icon = Icons.AutoMirrored.Filled.Send,
            title = stringResource(R.string.ui_your_chats_in_your_pocket),
            detail = stringResource(R.string.ui_pick_up_the_same_conversations_from_your_computer),
        )
        Benefit(
            icon = Icons.Filled.CheckCircle,
            title = stringResource(R.string.ui_respond_when_a_bot_needs_you),
            detail = stringResource(R.string.ui_review_approvals_without_going_back_to_your_desk),
        )
        Benefit(
            icon = Icons.Filled.Lock,
            title = stringResource(R.string.ui_private_by_design),
            detail = stringResource(R.string.ui_you_choose_which_trusted_computer_this_phone_connects_to),
        )
    }
}

@Composable
fun UnpairedHomeScreen(onConnect: () -> Unit, onOpenSettings: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.ui_startupbot),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).padding(start = 10.dp),
            )
            ChromeButton(
                icon = Icons.Filled.Settings,
                contentDescription = stringResource(R.string.ui_settings),
                onClick = onOpenSettings,
            )
        }
        HorizontalDivider()
        OnboardingLayout(
            actions = {
                MobileChatButton()
                Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.ui_onboardingcopy_unpaired_home_connect))
                }
            },
        ) {
            OnboardingHero(Icons.Filled.Phone)
            Text(
                text = stringResource(R.string.ui_onboardingcopy_unpaired_home_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            Text(
                text = stringResource(R.string.ui_onboardingcopy_unpaired_home_body),
                style = MaterialTheme.typography.bodyLarge,
                color = secondaryTint,
                textAlign = TextAlign.Center,
            )
            Text(
                text = stringResource(R.string.ui_onboardingcopy_unpaired_home_hint),
                fontSize = 13.sp,
                color = secondaryTint,
                textAlign = TextAlign.Center,
            )
        }
    }
}


@Composable
fun NotificationOnboardingScreen(
    enabling: Boolean,
    onEnable: () -> Unit,
    onSkip: () -> Unit,
) {
    OnboardingLayout(
        actions = {
            Button(
                onClick = onEnable,
                enabled = !enabling,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (enabling) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(stringResource(R.string.ui_onboardingcopy_notifications_enable))
                }
            }
            TextButton(
                onClick = onSkip,
                enabled = !enabling,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.ui_not_now))
            }
        },
    ) {
        OnboardingHero(Icons.Filled.Notifications)
        Text(
            text = stringResource(R.string.ui_onboardingcopy_notifications_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(R.string.ui_settingspolicy_notifications_footer),
            style = MaterialTheme.typography.bodyMedium,
            color = secondaryTint,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Benefit(
            icon = Icons.Filled.CheckCircle,
            title = stringResource(R.string.ui_onboardingcopy_notifications_approvals),
            detail = null,
        )
        Benefit(
            icon = Icons.AutoMirrored.Filled.Send,
            title = stringResource(R.string.ui_onboardingcopy_notifications_finished),
            detail = null,
        )
    }
}

@Composable
private fun OnboardingLayout(
    actions: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            content()
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            actions()
        }
    }
}

@Composable
private fun OnboardingHero(icon: ImageVector) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = CircleShape,
        modifier = Modifier.size(104.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.size(44.dp),
            )
        }
    }
}

@Composable
private fun Benefit(icon: ImageVector, title: String, detail: String?) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            detail?.let {
                Text(text = it, fontSize = 13.sp, color = secondaryTint)
            }
        }
    }
}
