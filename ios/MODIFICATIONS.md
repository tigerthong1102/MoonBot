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
- `App/LiveActivities.swift`
- `App/Localizable.xcstrings`
- `App/MarkdownText.swift`
- `App/MausAvatar.swift`
- `App/OnboardingViews.swift`
- `App/PairingScanner.swift`
- `App/PairingView.swift`
- `App/Session.swift`
- `App/SettingsView.swift`
- `App/SpeechDictation.swift`
- `App/TasksRoutinesView.swift`
- `App/Updates.swift`
- `AppShared/OpenMausSharedConfiguration.swift`
- `AppShared/OpenMausSharedKeychain.swift`
- `README.md`
- `ShareExtension/ShareItemLoader.swift`
- `ShareExtension/ShareRootView.swift`
- `ShareExtension/ShareViewModel.swift`
- `Sources/CompanionCore/AttachedMessageContent.swift`
- `Sources/CompanionCore/Client.swift`
- `Sources/CompanionCore/Failover.swift`
- `Sources/CompanionCore/MausSilhouette.swift`
- `Sources/CompanionCore/SSE.swift`
- `Sources/CompanionCore/SendReceipt.swift`
- `TESTING.md`
- `Tests/CompanionCoreTests/DecodingTests.swift`
- `Tests/CompanionCoreTests/MausBodiesTests.swift`
- `Tests/CompanionCoreTests/QueuedSendTests.swift`
- `Widgets/Info.plist`
- `project.yml`
