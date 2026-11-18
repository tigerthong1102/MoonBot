# StartupBot native modifications

Product labels, install identity, owned artwork and internal build configuration
are changed for StartupBot. Original LICENSE and NOTICE remain unmodified.
Protocol health identity, Bonjour service and HPKE domain separation are retained.
New compatibility tests cover both pairing URI schemes without loosening validation.
No Enterprise files, store marketing assets or upstream compiled apps are imported.

Modified imported files:

- `project.yml`
- `TESTING.md`
- `README.md`
- `ShareExtension/ShareItemLoader.swift`
- `ShareExtension/ShareViewModel.swift`
- `ShareExtension/ShareRootView.swift`
- `App/Localizable.xcstrings`
- `App/ConnectedAppsView.swift`
- `App/SettingsView.swift`
- `App/Session.swift`
- `App/PairingScanner.swift`
- `App/OnboardingViews.swift`
- `App/CloudDesktopBrowser.swift`
- `App/TasksRoutinesView.swift`
- `App/PairingView.swift`
- `App/AgentProfileView.swift`
- `App/MausAvatar.swift`
- `App/AttachmentViews.swift`
- `App/ChatView.swift`
- `App/SpeechDictation.swift`
- `AppShared/OpenMausSharedKeychain.swift`
- `AppShared/OpenMausSharedConfiguration.swift`
- `Widgets/Info.plist`
- `Sources/CompanionCore/SSE.swift`
- `Sources/CompanionCore/Failover.swift`
- `Sources/CompanionCore/MausSilhouette.swift`
- `Sources/CompanionCore/Client.swift`
- `Sources/CompanionCore/AttachedMessageContent.swift`
- `Tests/CompanionCoreTests/DecodingTests.swift`
- `App/Assets.xcassets/AppIcon.appiconset/icon-1024.png`
