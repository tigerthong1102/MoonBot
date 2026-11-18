// Modified for StartupBot; original copyright and license retained.
// External browser origin and credential isolation are required; provider session URLs must not be persisted or logged.
import SafariServices
import SwiftUI

struct CloudDesktopBrowser: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        configuration.barCollapsingEnabled = true
        let browser = SFSafariViewController(url: url, configuration: configuration)
        browser.dismissButtonStyle = .close
        browser.preferredControlTintColor = .systemBlue
        return browser
    }

    func updateUIViewController(_ browser: SFSafariViewController, context: Context) {}
}
