# StartupBot native modifications

Product labels, install identity, owned artwork and internal build configuration
are changed for StartupBot. Original LICENSE and NOTICE remain unmodified.
Protocol health identity, Bonjour service and HPKE domain separation are retained.
New compatibility tests cover both pairing URI schemes without loosening validation.
No Enterprise files, store marketing assets or upstream compiled apps are imported.

Modified imported files:

- `README.md`
- `settings.gradle.kts`
- `app/build.gradle.kts`
- `gradle/wrapper/gradle-wrapper.properties`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/kotlin/com/openmausbot/companion/ui/TranscriptCardViews.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ShareSheet.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ConnectedAppsScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/QrScannerScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PendingPairing.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MessageRow.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ProfileRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PairingHandoff.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RoutineRules.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SettingsScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/OnboardingScreens.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/ComposerAttachments.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/RosterScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/MausAvatar.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SharePolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/SettingsPolicy.kt`
- `app/src/main/kotlin/com/openmausbot/companion/ui/PairingScreen.kt`
- `app/src/main/kotlin/com/openmausbot/companion/lifecycle/AlwaysOnConnectionService.kt`
- `app/src/main/kotlin/com/openmausbot/companion/browser/CloudDesktopBrowser.kt`
- `app/src/main/kotlin/com/openmausbot/companion/dictation/SpeechDictation.kt`
- `app/src/main/kotlin/com/openmausbot/companion/notifications/LocalNotificationPoster.kt`
- `app/src/main/res/drawable/ic_launcher_monochrome.xml`
- `app/src/main/res/drawable/ic_launcher_foreground.xml`
- `app/src/main/res/values-night/themes.xml`
- `app/src/main/res/values/themes.xml`
- `app/src/main/res/values/strings.xml`
- `app/src/preview/res/values/strings.xml`
- `app/src/test/kotlin/com/openmausbot/companion/PairingLinkManifestTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SettingsPolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SettingsReconnectWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/SharePolicyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/VoiceSectionWiringTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/PhoneSectionCopyTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/ProfileRulesTest.kt`
- `app/src/test/kotlin/com/openmausbot/companion/ui/PairingStateTest.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Connection.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Failover.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Session.kt`
- `core/src/main/kotlin/com/openmausbot/companion/core/Client.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/DecodingTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/FailoverTest.kt`
- `core/src/test/kotlin/com/openmausbot/companion/core/PairingClientTest.kt`
