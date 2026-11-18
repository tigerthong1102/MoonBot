# StartupBot native modifications

Product labels, install identity, owned artwork and internal build configuration
are changed for StartupBot. Original LICENSE and NOTICE remain unmodified.
Protocol health identity, Bonjour service and HPKE domain separation are retained.
New compatibility tests cover both pairing URI schemes without loosening validation.
No Enterprise files, store marketing assets or upstream compiled apps are imported.

Internal 0.1.1 adds scoped iOS send completion/receipt handling and native
regression tests, runtime-scoped history/profile/routine/connector results,
one priority Live Activity per bot, and active-thread image
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

Internal iOS build 12 separates ARM64 and Intel simulator packages without removing executable code, and adds a device-SDK Release archive build without store signing. Bundle, data and secure-store identities are unchanged.

Internal build 12 pins permission remembering and approval to one captured client/runtime, stops after failed grants, and tests computer switches including a replacement runtime with the same connection ID.

Internal Android 0.1.7 / iOS build 13 keeps channel unread updates scoped to individual tasks. Android calls recover listening after failed sends without reopening a hung-up or foreign call; iOS voice previews release audio on completion, failure, replacement and dismissal, and reject late preview data. New regression tests cover these lifecycles.

Internal Android 0.1.8 / iOS build 14 connects old search results to the rendered active branch with bounded history requests and retained live leaf updates. Regression coverage includes disconnected windows, malformed pages, byte/page budgets and real client requests.

Native review corrections scope late bot-queue receipts to the captured authoritative snapshot revision and refuse Android call playback when audio focus is denied. Imported implementation/history narration is removed across native sources; public wire contracts, external platform facts, security constraints and original notices are retained. Modified imported source files carry explicit StartupBot modification notices. This comment-policy pass preserves every non-comment code and literal token.

The cached-search correction permits immediate focus only when the hit is already rendered and the current leaf is present. Sparse cached windows still require bounded history recovery. iOS build 15 includes this correction. A final comment-only pass additionally uses the Kotlin 2.2.21 lexer to verify code and literal token equality.

Independent PR-wide audit: runtime-scoped Android HTTP results/errors and multi-step approvals/avatar changes; cached and advancing search history; iOS notification failure targets; bounded HTTP/SSE reads; iOS redirect refusal and credential-free server identity checks; Android voice keys require HTTPS and are not saved in UI restoration state. Original OSS features and protocol identifiers remain. Store signing, physical devices and live providers require separate acceptance.

Unused upstream store-export signing identity is removed; export is local-only and owner-configured. Manifest/resource comments retain only platform/security facts, with XML values/attributes unchanged.

Modified imported files:

- `App/ActivityRunChip.swift`
- `App/AgentProfileView.swift`
- `App/AppLanguage.swift`
- `App/Assets.xcassets/AppIcon.appiconset/icon-1024.png`
- `App/AttachmentViews.swift`
- `App/BotAvatarView.swift`
- `App/BotOverviewView.swift`
- `App/BotThreadRow.swift`
- `App/BotThreadTree.swift`
- `App/Cards/AgentThoughtChamberView.swift`
- `App/Cards/GitPRDiffCardView.swift`
- `App/Cards/SQLResultTableView.swift`
- `App/Cards/SkillExecutionReceiptView.swift`
- `App/ChatListView.swift`
- `App/ChatView.swift`
- `App/CloudDesktopBrowser.swift`
- `App/CompanionApp.swift`
- `App/CompanionLayout.swift`
- `App/Composer/CommandSkillHUDView.swift`
- `App/Composer/PredictiveActionChipsView.swift`
- `App/Composer/TypingIndicatorView.swift`
- `App/ComputerView.swift`
- `App/ConnectedAppsView.swift`
- `App/Discovery.swift`
- `App/Glass.swift`
- `App/Island.swift`
- `App/LiveActivities.swift`
- `App/Localizable.xcstrings`
- `App/MarkdownText.swift`
- `App/MascotState.swift`
- `App/MausAvatar.swift`
- `App/MausFaceData.swift`
- `App/NewGroupSheet.swift`
- `App/NewSectionSheet.swift`
- `App/Notifications.swift`
- `App/OnboardingViews.swift`
- `App/PairingScanner.swift`
- `App/PairingView.swift`
- `App/PlatformBridge.swift`
- `App/Preferences.swift`
- `App/QueuedSendRow.swift`
- `App/QuickRepliesEditor.swift`
- `App/SelectableTextSheet.swift`
- `App/Session.swift`
- `App/SettingsView.swift`
- `App/SpeechBubble.swift`
- `App/SpeechDictation.swift`
- `App/TaskManagerView.swift`
- `App/TasksRoutinesView.swift`
- `App/Updates.swift`
- `App/UpdatesSheet.swift`
- `AppShared/OpenMausSharedConfiguration.swift`
- `AppShared/OpenMausSharedConnectionStore.swift`
- `AppShared/OpenMausSharedInbox.swift`
- `AppShared/OpenMausSharedKeychain.swift`
- `ExportOptions.plist`
- `Package.swift`
- `README.md`
- `ShareExtension/ShareItemLoader.swift`
- `ShareExtension/ShareRootView.swift`
- `ShareExtension/ShareViewModel.swift`
- `Shared/BotActivity.swift`
- `Sources/CompanionCore/AnimatedImage.swift`
- `Sources/CompanionCore/AttachedMessageContent.swift`
- `Sources/CompanionCore/BotActivityContent.swift`
- `Sources/CompanionCore/BotAvatarRendering.swift`
- `Sources/CompanionCore/ChatPreferences.swift`
- `Sources/CompanionCore/Client.swift`
- `Sources/CompanionCore/ComposerKeyboard.swift`
- `Sources/CompanionCore/ConnectionRegistry.swift`
- `Sources/CompanionCore/Dictation.swift`
- `Sources/CompanionCore/Endpoint.swift`
- `Sources/CompanionCore/Failover.swift`
- `Sources/CompanionCore/Frames.swift`
- `Sources/CompanionCore/Markdown.swift`
- `Sources/CompanionCore/MausBodies.swift`
- `Sources/CompanionCore/MausSilhouette.swift`
- `Sources/CompanionCore/MessageAttachments.swift`
- `Sources/CompanionCore/Models.swift`
- `Sources/CompanionCore/Onboarding.swift`
- `Sources/CompanionCore/SSE.swift`
- `Sources/CompanionCore/SectionSelection.swift`
- `Sources/CompanionCore/SendReceipt.swift`
- `Sources/CompanionCore/Store.swift`
- `Sources/CompanionCore/ThreadNavigation.swift`
- `TESTING.md`
- `Tests/CompanionCoreTests/AnimatedImageTests.swift`
- `Tests/CompanionCoreTests/ApprovalClientTests.swift`
- `Tests/CompanionCoreTests/BotActivityContentTests.swift`
- `Tests/CompanionCoreTests/BotAvatarRenderingTests.swift`
- `Tests/CompanionCoreTests/ChatPreferencesTests.swift`
- `Tests/CompanionCoreTests/ConnectionTests.swift`
- `Tests/CompanionCoreTests/DecodingTests.swift`
- `Tests/CompanionCoreTests/DictationTests.swift`
- `Tests/CompanionCoreTests/EventStreamTests.swift`
- `Tests/CompanionCoreTests/FailoverTests.swift`
- `Tests/CompanionCoreTests/MarkdownTests.swift`
- `Tests/CompanionCoreTests/MausBodiesTests.swift`
- `Tests/CompanionCoreTests/OnboardingTests.swift`
- `Tests/CompanionCoreTests/OverviewClientTests.swift`
- `Tests/CompanionCoreTests/ProfileRoutinePolicyTests.swift`
- `Tests/CompanionCoreTests/QueuedSendTests.swift`
- `Tests/CompanionCoreTests/RosterPreviewTests.swift`
- `Tests/CompanionCoreTests/SSETests.swift`
- `Tests/CompanionCoreTests/ServerPairingTests.swift`
- `Tests/CompanionCoreTests/ShareClientTests.swift`
- `Tests/CompanionCoreTests/StoreTests.swift`
- `Tests/CompanionCoreTests/WaitingThreadHydrationTests.swift`
- `UITests/ThreadNavigationUITests.swift`
- `Widgets/Info.plist`
- `Widgets/OpenMausWidgets.swift`
- `project.yml`
