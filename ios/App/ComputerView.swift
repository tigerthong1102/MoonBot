// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import CompanionCore
import UIKit

struct ComputerView: View {
    let bot: Bot
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDesktop = false
    @State private var openingDesktop = false
    @State private var desktopURL: URL?
    @State private var desktopError: String?

    private var frame: ScreenFrame? { session.state.screens[bot.id] }

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let image = frame.flatMap(\.data).flatMap(UIImage.init(data:)) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel("\(current.name)'s computer")
            } else {
                waiting
            }
        }
        .navigationTitle(current.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text(current.busy == true ? "Preview" : "Idle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(current.busy == true ? Color.green : Color.secondary)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if current.computer == "cloud" && current.cloudBackend != "vps" && session.canAdminister {
                VStack(spacing: 8) {
                    if let desktopError {
                        Text(desktopError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                    Button {
                        confirmingDesktop = true
                    } label: {
                        if openingDesktop {
                            ProgressView()
                                .tint(.white)
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("Open live cloud desktop", systemImage: "display")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(openingDesktop)
                    Text("Interactive VNC session. Access must be enabled for this device in the Mac's Phone settings.")
                        .font(.caption)
                        .foregroundStyle(Color.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(.ultraThinMaterial)
            }
        }
        .alert("Open live cloud desktop?", isPresented: $confirmingDesktop) {
            Button("Cancel", role: .cancel) {}
            Button("Open desktop") { Task { await openDesktop() } }
        } message: {
            Text("This gives this device full control of the cloud computer, including anything signed in inside it.")
        }
        .sheet(
            isPresented: Binding(
                get: { desktopURL != nil },
                set: { if !$0 { desktopURL = nil } }
            )
        ) {
            if let desktopURL {
                CloudDesktopBrowser(url: desktopURL)
                    .ignoresSafeArea()
            }
        }
        .onAppear {
            session.watchScreen(of: bot.id)
        }
        .onDisappear {
            session.stopWatchingScreen(of: bot.id)
        }
    }

    private var waiting: some View {
        VStack(spacing: 12) {
            ProgressView().tint(.white)
            Text(current.busy == true ? "Waiting for a frame…" : "Nothing to show yet")
                .font(.system(size: 15))
                .foregroundStyle(Color.white.opacity(0.7))
            if current.busy != true {
                Text("This bot's computer is only captured while it is working.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
    }

    @MainActor
    private func openDesktop() async {
        openingDesktop = true
        desktopError = nil
        defer { openingDesktop = false }
        do {
            desktopURL = try await session.cloudDesktop(for: current)
        } catch {
            desktopError = error.localizedDescription
        }
    }
}
