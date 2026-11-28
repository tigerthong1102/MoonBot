import CompanionCore
import SwiftUI

struct MobileChatButton: View {
    @EnvironmentObject private var session: Session
    @State private var presenting = false

    static var origin: URLComponents? {
        guard let setting = Bundle.main.object(forInfoDictionaryKey: "StartupBotMobileOrigin") as? String,
              let url = URLComponents(string: setting), url.scheme == "https", url.host?.isEmpty == false,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return nil }
        return url
    }

    var body: some View {
        if let address = Self.origin?.string, let connection = Connection.parse(address) {
            Button { presenting = true } label: {
                Label { Text("Chat without a computer", tableName: "StartupBotMobile") } icon: { Image(systemName: "bubble.left.and.bubble.right") }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .sheet(isPresented: $presenting) { MobileEmailLogin(connection: connection).environmentObject(session) }
        }
    }
}

private struct MobileEmailLogin: View {
    let connection: Connection
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var handoffAvailable = false
    @State private var allowDrafts = false
    @State private var saveHistory = false
    @State private var sent = false
    @State private var error: String?
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.emailAddress).textContentType(.emailAddress)
                    .disabled(sent || submitting)
                if sent {
                    if handoffAvailable {
                        Toggle(isOn: $allowDrafts) { Text("Send desktop tasks to my receiving computer", tableName: "StartupBotMobile") }
                    }
                    Toggle(isOn: $saveHistory) { Text("Save chats to my account", tableName: "StartupBotMobile") }
                    TextField(text: $code) { Text("Email code", tableName: "StartupBotMobile") }
                        .keyboardType(.numberPad).textContentType(.oneTimeCode)
                    Button { sent = false; code = ""; error = nil } label: {
                        Text("Change email or resend", tableName: "StartupBotMobile")
                    }.disabled(submitting)
                }
                if let error { Text(error).foregroundStyle(.red) }
                Button { submitting = true } label: {
                    if submitting { ProgressView() }
                    else if sent { Text("Sign in", tableName: "StartupBotMobile") }
                    else { Text("Send email code", tableName: "StartupBotMobile") }
                }.disabled(submitting || email.isEmpty || (sent && (code.isEmpty || !saveHistory)))
            }
            .navigationTitle(Text("Chat without a computer", tableName: "StartupBotMobile"))
            .toolbar { Button("Cancel") { dismiss() }.accessibilityIdentifier("mobile-login-cancel") }
            .task(id: submitting) {
                guard submitting else { return }
                defer { submitting = false }
                error = nil
                do {
                    let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
                    if sent {
                        try await session.signInToMobile(connection, email: address, code: code, allowDrafts: allowDrafts)
                        dismiss()
                    } else {
                        let response = try await CompanionClient(connection: connection, token: nil).requestMobileCode(email: address)
                        handoffAvailable = response.desktopHandoff
                        allowDrafts = false
                        saveHistory = false
                        sent = true
                    }
                } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            }
        }
    }
}
