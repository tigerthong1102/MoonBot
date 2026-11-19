import SwiftUI
@main struct Touch: App {
    var body: some Scene {
        WindowGroup {
            Button("Open StartupBot invitation") {
                Task {
                    do {
                        var r = URLRequest(url: URL(string:"http://127.0.0.1:19812/open")!)
                        r.httpMethod = "POST"
                        let (data, _) = try await URLSession.shared.data(for: r)
                        guard let text = String(data: data, encoding: .utf8), let url = URL(string:text) else {return}
                        await UIApplication.shared.open(url)
                    } catch {}
                }
            }
        }
    }
}
