# StartupBot native modifications

Product labels, install identity, owned artwork and internal build configuration
are changed for StartupBot. Original LICENSE and NOTICE remain unmodified.
Protocol health identity, Bonjour service and HPKE domain separation are retained.
New compatibility tests cover both pairing URI schemes without loosening validation.
No Enterprise files, store marketing assets or upstream compiled apps are imported.

Internal 0.1.1 adds scoped iOS send completion/receipt handling and native
regression tests, one priority Live Activity per bot, and active-thread image
model selection in both share clients. Imported historical comment narration
is removed; license/attribution, OS facts and security contracts are retained.
All platform acceptance must be rerun for this changed native source.

Internal 0.1.2 adds structured iOS question inputs and strict question/permission
classification. Shared canonical answer vectors verify both mobile formatters,
including newline/header boundaries. Android honors option-only questions and
keeps failed submissions retryable until server acknowledgment. iOS callback
scope includes bot/task/history/profile/routine/connector operations. These
changes require fresh native acceptance and do not change transport scopes.

Notification origin is scoped to the paired computer. Background channel task approvals are recovered and owned by their exact thread. No phone token or credential is included in notification payloads.

Modified imported files:

- `.gitignore`
- `README.md`
- `app/build.gradle.kts`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/kotlin/com/openmausbot/companion/audio/VoiceNotePlayer.kt`
- `app/src/main/kotlin/com/openmausbot/companion/browser/CloudDesktopBrowser.kt`
- `app/src/main/kotlin/com/openmausbot/companion/dictation/SpeechDictation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/AlwaysOnConnectionService.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/LocalNotificationPoster.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/NotificationIntents.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/NotificationMapping.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ChatPolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ChatScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ComposerAttachments.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ConnectedAppsScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ExecutionFeedback.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausAvatar.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausBodies.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausSilhouette.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MessageRow.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ModelRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/NotificationTapCoordinator.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/OnboardingScreens.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PairingHandoff.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PairingScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PendingPairing.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PendingThreadNavigation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PermissionRequests.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ProfileRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QrScannerScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QuestionCard.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RootScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RosterScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RoutineRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SettingsPolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SettingsScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SharePolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ShareSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TasksRoutinesScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TranscriptCardViews.kt`
- `app/src/main/res/drawable/ic_launcher_foreground.xml`
- `app/src/main/res/drawable/ic_launcher_monochrome.xml`
- `app/src/main/res/values-night/themes.xml`
- `app/src/main/res/values/strings.xml`
- `app/src/main/res/values/themes.xml`
- `app/src/preview/res/values/strings.xml`
- `app/src/test/kotlin/com/openmausbot/companion/PairingLinkManifestTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/audio/VoiceNotePlayerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/avatar/AvatarImageRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/LingerTestSupport.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/SessionLingerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/SessionLingerWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/notifications/NotificationDirectionTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/notifications/NotificationIntentsTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/notifications/NotificationMappingTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/AttachmentRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ChatDraftHolderTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/MausBodiesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ModelRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NavigationTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NotificationOpenTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NotificationTapCoordinatorTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/PairingStateTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/PhoneSectionCopyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ProfileRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/RoutineRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SettingsPolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SettingsReconnectWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SharePolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/TranscriptRunTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/VoiceSectionWiringTest.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/AskQuestion.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Client.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Connection.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Failover.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Models.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/SendReceipt.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Session.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/SessionStorage.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/ThreadNavigation.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/AskQuestionTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/DecodingTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/FailoverTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/FixtureSupport.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/PairingClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/QueuedSendTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionP1Test.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionRouteSerializationTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ThreadNavigationTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/TranscriptTest.kt`
- `gradle/wrapper/gradle-wrapper.properties`
- `gradlew.bat`
- `settings.gradle.kts`
