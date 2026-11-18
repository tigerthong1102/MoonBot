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

Modified imported files:

- `App/AgentProfileView.swift`
- `App/Assets.xcassets/AppIcon.appiconset/icon-1024.png`
- `App/AttachmentViews.swift`
- `App/Cards/AgentThoughtChamberView.swift`
- `App/Cards/GitPRDiffCardView.swift`
- `App/Cards/SQLResultTableView.swift`
- `App/Cards/SkillExecutionReceiptView.swift`
- `App/ChatView.swift`
- `App/CloudDesktopBrowser.swift`
- `App/CompanionApp.swift`
- `App/Composer/CommandSkillHUDView.swift`
- `App/Composer/PredictiveActionChipsView.swift`
- `App/Composer/TypingIndicatorView.swift`
- `App/ConnectedAppsView.swift`
- `App/Island.swift`
- `App/LiveActivities.swift`
- `App/Localizable.xcstrings`
- `App/MarkdownText.swift`
- `App/MausAvatar.swift`
- `App/Notifications.swift`
- `App/OnboardingViews.swift`
- `App/PairingScanner.swift`
- `App/PairingView.swift`
- `App/Session.swift`
- `App/SettingsView.swift`
- `App/SpeechDictation.swift`
- `App/TaskManagerView.swift`
- `App/TasksRoutinesView.swift`
- `App/Updates.swift`
- `AppShared/OpenMausSharedConfiguration.swift`
- `AppShared/OpenMausSharedKeychain.swift`
- `README.md`
- `ShareExtension/ShareItemLoader.swift`
- `ShareExtension/ShareRootView.swift`
- `ShareExtension/ShareViewModel.swift`
- `Shared/BotActivity.swift`
- `Sources/CompanionCore/AttachedMessageContent.swift`
- `Sources/CompanionCore/BotActivityContent.swift`
- `Sources/CompanionCore/Client.swift`
- `Sources/CompanionCore/Failover.swift`
- `Sources/CompanionCore/Frames.swift`
- `Sources/CompanionCore/MausBodies.swift`
- `Sources/CompanionCore/MausSilhouette.swift`
- `Sources/CompanionCore/Models.swift`
- `Sources/CompanionCore/SSE.swift`
- `Sources/CompanionCore/SendReceipt.swift`
- `Sources/CompanionCore/Store.swift`
- `TESTING.md`
- `Tests/CompanionCoreTests/ApprovalClientTests.swift`
- `Tests/CompanionCoreTests/BotActivityContentTests.swift`
- `Tests/CompanionCoreTests/DecodingTests.swift`
- `Tests/CompanionCoreTests/MausBodiesTests.swift`
- `Tests/CompanionCoreTests/QueuedSendTests.swift`
- `Tests/CompanionCoreTests/WaitingThreadHydrationTests.swift`
- `Widgets/Info.plist`
- `Widgets/OpenMausWidgets.swift`
- `project.yml`
