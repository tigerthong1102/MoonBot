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

Internal Android 0.1.6 adds ABI-specific Gradle packages alongside the universal APK and AAB, preserving all shared bytecode/resources and each CPU’s native libraries. Signing and full runtime features are retained.

Internal Android 0.1.7 / iOS build 13 keeps channel unread updates scoped to individual tasks. Android calls recover listening after failed sends without reopening a hung-up or foreign call; iOS voice previews release audio on completion, failure, replacement and dismissal, and reject late preview data. New regression tests cover these lifecycles.

Internal Android 0.1.8 / iOS build 14 connects old search results to the rendered active branch with bounded history requests and retained live leaf updates. Regression coverage includes disconnected windows, malformed pages, byte/page budgets and real client requests.

Native review corrections scope late bot-queue receipts to the captured authoritative snapshot revision and refuse Android call playback when audio focus is denied. Imported implementation/history narration is removed across native sources; public wire contracts, external platform facts, security constraints and original notices are retained. Modified imported source files carry explicit StartupBot modification notices. This comment-policy pass preserves every non-comment code and literal token.

The cached-search correction permits immediate focus only when the hit is already rendered and the current leaf is present. Sparse cached windows still require bounded history recovery. iOS build 15 includes this correction. A final comment-only pass additionally uses the Kotlin 2.2.21 lexer to verify code and literal token equality.

Independent PR-wide audit: runtime-scoped Android HTTP results/errors and multi-step approvals/avatar changes; cached and advancing search history; iOS notification failure targets; bounded HTTP/SSE reads; iOS redirect refusal and credential-free server identity checks; Android voice keys require HTTPS and are not saved in UI restoration state. Original OSS features and protocol identifiers remain. Store signing, physical devices and live providers require separate acceptance.

Unused upstream store-export signing identity is removed; export is local-only and owner-configured. Manifest/resource comments retain only platform/security facts, with XML values/attributes unchanged.

Modified imported files:

- `.gitignore`
- `README.md`
- `app/build.gradle.kts`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/kotlin/com/openmausbot/companion/MainActivity.kt`
- `app/src/main/kotlin/com/openmausbot/companion/OpenMausApp.kt`
- `app/src/main/kotlin/com/openmausbot/companion/PairingLinkActivity.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ShareReceiveActivity.kt`
- `app/src/main/kotlin/com/openmausbot/companion/audio/CallSpeaker.kt`
- `app/src/main/kotlin/com/openmausbot/companion/audio/VoiceNotePlayer.kt`
- `app/src/main/kotlin/com/openmausbot/companion/audio/VoicePreviewPlayer.kt`
- `app/src/main/kotlin/com/openmausbot/companion/avatar/AvatarImagePicker.kt`
- `app/src/main/kotlin/com/openmausbot/companion/avatar/AvatarImageRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/avatar/AvatarImageStore.kt`
- `app/src/main/kotlin/com/openmausbot/companion/avatar/DecodedAvatar.kt`
- `app/src/main/kotlin/com/openmausbot/companion/browser/CloudDesktopBrowser.kt`
- `app/src/main/kotlin/com/openmausbot/companion/dictation/SpeechDictation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/discovery/NsdDiscovery.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/AlwaysOnBootReceiver.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/AlwaysOnConnectionService.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/AlwaysOnConnectionState.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/ServiceProcessAnchor.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/SessionLingerController.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/SessionLingerService.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/LocalNotificationPoster.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/NotificationIntents.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/NotificationMapping.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/NotificationText.kt`
- `app/src/main/kotlin/com/openmausbot/companion/permissions/CompanionPermissions.kt`
- `app/src/main/kotlin/com/openmausbot/companion/sharing/ShareInbox.kt`
- `app/src/main/kotlin/com/openmausbot/companion/sharing/ShareItemLoader.kt`
- `app/src/main/kotlin/com/openmausbot/companion/sharing/ShareSheetSession.kt`
- `app/src/main/kotlin/com/openmausbot/companion/sharing/TranscriptSharing.kt`
- `app/src/main/kotlin/com/openmausbot/companion/storage/AlwaysOnPreferences.kt`
- `app/src/main/kotlin/com/openmausbot/companion/storage/ChatPreferences.kt`
- `app/src/main/kotlin/com/openmausbot/companion/storage/DataStoreConnectionStore.kt`
- `app/src/main/kotlin/com/openmausbot/companion/storage/KeystoreTokenStore.kt`
- `app/src/main/kotlin/com/openmausbot/companion/storage/OnboardingPreferences.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/AgentProfileSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/AttentionInbox.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/BotAvatar.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/BotOverviewScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/BotThreadRow.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/BotThreadTree.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/CallRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/CallScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ChatComposerDraft.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ChatDraftHolder.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ChatPolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ChatScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/Chrome.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ClaudeUpdateCard.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/CommandHud.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/CompanionEnvironment.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/CompanionTheme.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ComposerAttachments.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ComposerReturn.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ComputerPolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ComputerScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ConnectedAppsScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ExecutionFeedback.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/FilePreview.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/Haptics.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/InlineMarkdown.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MarkdownText.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MascotState.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausAvatar.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausBodies.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausComets.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausFaceData.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausFaceEngine.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausPalette.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausSilhouette.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MessageRow.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ModelRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/Navigation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/NewGroupSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/NewSectionSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/NotificationOpen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/NotificationTapCoordinator.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/OnboardingScreens.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/OverviewRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PairingHandoff.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PairingScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PendingPairing.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PendingThreadNavigation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PermissionRequests.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ProfileRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QrScannerScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QuestionCard.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QueuedSendRow.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QuickRepliesEditor.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RelativeStamp.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RootScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RosterScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RoutineEditorSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RoutineRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SettingsPolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SettingsScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SharePayload.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SharePolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ShareSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SnoozeRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SpeechBubble.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TaskRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TaskSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TasksRoutinesScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TranscriptCardViews.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TranscriptPresentation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/Updates.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/UpdatesSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/VoiceSettingsScreen.kt`
- `app/src/main/res/drawable/ic_attach_file.xml`
- `app/src/main/res/drawable/ic_block.xml`
- `app/src/main/res/drawable/ic_call_end.xml`
- `app/src/main/res/drawable/ic_chat_bubbles.xml`
- `app/src/main/res/drawable/ic_cloud.xml`
- `app/src/main/res/drawable/ic_display.xml`
- `app/src/main/res/drawable/ic_hub.xml`
- `app/src/main/res/drawable/ic_launcher_foreground.xml`
- `app/src/main/res/drawable/ic_launcher_monochrome.xml`
- `app/src/main/res/drawable/ic_mic.xml`
- `app/src/main/res/drawable/ic_pan_tool.xml`
- `app/src/main/res/drawable/ic_pause_circle.xml`
- `app/src/main/res/drawable/ic_phone.xml`
- `app/src/main/res/drawable/ic_photo.xml`
- `app/src/main/res/drawable/ic_remove.xml`
- `app/src/main/res/drawable/ic_schedule.xml`
- `app/src/main/res/drawable/ic_sparkles.xml`
- `app/src/main/res/drawable/ic_volume_off.xml`
- `app/src/main/res/drawable/ic_volume_up.xml`
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- `app/src/main/res/values-night/themes.xml`
- `app/src/main/res/values/colors.xml`
- `app/src/main/res/values/strings.xml`
- `app/src/main/res/values/themes.xml`
- `app/src/main/res/xml/backup_rules.xml`
- `app/src/main/res/xml/data_extraction_rules.xml`
- `app/src/main/res/xml/file_paths.xml`
- `app/src/main/res/xml/network_security_config.xml`
- `app/src/preview/AndroidManifest.xml`
- `app/src/preview/res/values/strings.xml`
- `app/src/test/kotlin/com/openmausbot/companion/PairingLinkManifestTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/audio/VoiceNotePlayerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/audio/VoicePreviewControllerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/audio/VoicePreviewPlayerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/avatar/AvatarImagePickerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/avatar/AvatarImageRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/avatar/AvatarImageStoreTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/dictation/SpeechDictationTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/discovery/NsdDiscoveryTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/discovery/NsdResolveTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/LingerTestSupport.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/SessionLingerServiceTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/SessionLingerTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/lifecycle/SessionLingerWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/notifications/NotificationDirectionTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/notifications/NotificationIntentsTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/notifications/NotificationMappingTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/onboarding/OnboardingRoutingTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/onboarding/OnboardingScene.kt`
- `app/src/test/kotlin/com/openmausbot/companion/sharing/ShareHandoffTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/sharing/ShareItemLoaderTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/storage/DataStoreConnectionStoreTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/storage/KeystoreTokenStoreTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/storage/OnboardingPreferencesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/storage/PersistenceContractTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/AndroidThreadNavigationTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ApprovalAnswersTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/AttachmentRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/AttentionInboxTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/BotAvatarRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/BotThreadRowTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/BotThreadTreeTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/CallRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ChatDraftHolderTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ChatPolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ComputerPolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ConnectedAppsForegroundWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ExecutionFeedbackTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/GeneratedImageWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/InlineMarkdownTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/MascotStateTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/MausAvatarTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/MausBodiesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/MausCatalogueGoldenTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/MausFaceTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ModelRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NavigationTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NewGroupRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NotificationOpenTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/NotificationTapCoordinatorTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/OverviewRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/PairingStateTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ParagraphDirectionTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/PhoneSectionCopyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ProfileRoutineWireTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ProfileRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/QuestionCardRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/QuickReplyGlyphParityTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/RelativeStampTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/RosterLayoutTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/RoutineRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SectionRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ServerPairingScreenTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SettingsPolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SettingsReconnectWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SharePolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SlashCommandTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SnoozeRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SpeechBubbleTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/TableReadingOrderTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/TaskRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/TranscriptPresentationTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/TranscriptRunTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/UpdatesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/VoiceNoteWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/VoiceSectionWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/WiringScene.kt`
- `core/build.gradle.kts`
- `core/src/main/kotlin/com/openmausbot/companion/core/AskQuestion.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/AttachedMessageContent.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Chat.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/ChatPreferences.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Client.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Connection.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/ConnectionRegistry.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Dictation.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Endpoint.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Failover.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/MessageAttachments.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Models.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Onboarding.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/SendReceipt.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/ServerTransport.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Session.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/SessionStorage.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/SharedMessage.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Sse.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Store.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/ThreadNavigation.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Transcript.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/WebhookMessageContent.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/AskQuestionTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/BotModelClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ChatPreferencesTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ChatSummaryTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ClaudeUpdateClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ConnectedAppsClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ConnectionTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/DecodingTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/DictationTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/FailoverTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/FileDownloadClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/FixtureSupport.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/MascotBodyDecodingTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/MessageAttachmentsTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/MultiComputerSessionTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/OnboardingTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/PairingClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/PortP104IntegratedTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/QueuedSendTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/RosterPreviewTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ServerSessionPairingTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionInviteLifecycleTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionOnboardingMarkerTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionP1Test.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionRouteSerializationTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionStreamRecoveryTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionTaskCrudTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SessionTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/SseTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/StoreTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/ThreadNavigationTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/TranscriptTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/VoiceClientTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/VoiceNotesTest.kt`
- `gradle/wrapper/gradle-wrapper.properties`
- `gradlew.bat`
- `settings.gradle.kts`
