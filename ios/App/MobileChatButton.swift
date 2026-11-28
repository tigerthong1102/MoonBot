import SafariServices
import SwiftUI

struct MobileChatButton: View {
    @Environment(\.locale) private var locale
    @State private var presenting = false

    static var origin: URLComponents? {
        guard let setting = Bundle.main.object(forInfoDictionaryKey: "StartupBotMobileOrigin") as? String,
              let url = URLComponents(string: setting), url.scheme == "https", url.host?.isEmpty == false,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return nil }
        return url
    }

    private var address: URL? {
        guard var url = Self.origin else { return nil }
        url.path = "/mobile"
        url.queryItems = [URLQueryItem(name: "lang", value: locale.identifier)]
        return url.url
    }

    var body: some View {
        if let address {
            Button { presenting = true } label: {
                Label { Text("Chat without a computer", tableName: "StartupBotMobile") } icon: { Image(systemName: "bubble.left.and.bubble.right") }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .sheet(isPresented: $presenting) { MobileChatBrowser(address: address).ignoresSafeArea() }
        }
    }
}

private struct MobileChatBrowser: UIViewControllerRepresentable {
    let address: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: address)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
