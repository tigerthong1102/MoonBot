import Combine
import SwiftUI
import UIKit
import WebKit

struct PersonalInboxView: UIViewRepresentable {
    static let origin: URL? = {
        guard let setting = Bundle.main.object(forInfoDictionaryKey: "StartupBotInboxOrigin") as? String,
              let url = URL(string: setting), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return nil }
        return url
    }()

    let origin: URL
    @Environment(\.locale) private var locale

    func makeCoordinator() -> Coordinator { Coordinator(origin: origin) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(context.coordinator, name: "startupbotVoice")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        context.coordinator.view = view
        var address = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        address.queryItems = [
            URLQueryItem(name: "mobile", value: "ios"),
            URLQueryItem(name: "lang", value: locale.identifier),
        ]
        view.load(URLRequest(url: address.url!))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.stop()
        view.configuration.userContentController.removeScriptMessageHandler(forName: "startupbotVoice")
        view.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
        weak var view: WKWebView?
        private let origin: URL
        private let dictation = SpeechDictation()
        private var subscription: AnyCancellable?
        private var token: String?
        private var started = false
        private var last = ""
        private var downloads: [ObjectIdentifier: URL] = [:]

        init(origin: URL) {
            self.origin = origin
            super.init()
        }

        private func trusted(_ url: URL?) -> Bool {
            url?.scheme == "https" && url?.host == origin.host && (url?.port ?? 443) == (origin.port ?? 443)
                && url?.user == nil && url?.password == nil
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), trusted(view?.url), view?.window != nil,
                  let command = message.body as? [String: String], let id = command["id"], UUID(uuidString: id) != nil else { return }
            switch command["action"] {
            case "start" where token == nil:
                token = id
                started = false
                last = ""
                dictation.toggle(capturing: "")
                subscription = dictation.$transcript.combineLatest(dictation.$isStarting, dictation.$isListening, dictation.$error)
                    .receive(on: RunLoop.main)
                    .sink { [weak self] text, starting, listening, error in
                        self?.update(id: id, text: text, active: starting || listening, failed: error != nil)
                    }
            case "finish" where token == id:
                stop()
                send(["id": id, "status": "done"])
            case "cancel" where token == id:
                stop()
            default: break
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard action.targetFrame?.isMainFrame == true, trusted(action.request.url) else { decisionHandler(.cancel); return }
            if action.shouldPerformDownload { decisionHandler(.download); return }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { stop() }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                      suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            guard trusted(response.url) else { completionHandler(nil); return }
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)) != nil else {
                completionHandler(nil)
                return
            }
            let basename = URL(fileURLWithPath: suggestedFilename).lastPathComponent
            let path = folder.appendingPathComponent(basename.isEmpty ? "StartupBot" : basename)
            downloads[ObjectIdentifier(download)] = path
            completionHandler(path)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let path = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
            var responder: UIResponder? = view
            while let node = responder, !(node is UIViewController) { responder = node.next }
            guard let controller = responder as? UIViewController, let view else {
                try? FileManager.default.removeItem(at: path.deletingLastPathComponent())
                return
            }
            let share = UIActivityViewController(activityItems: [path], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = view
            share.popoverPresentationController?.sourceRect = view.bounds
            share.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: path.deletingLastPathComponent())
            }
            controller.present(share, animated: true)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let path = downloads.removeValue(forKey: ObjectIdentifier(download)) {
                try? FileManager.default.removeItem(at: path.deletingLastPathComponent())
            }
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let primaryPort = origin.port == 0 ? 443 : origin.port
            let allowed = frame.isMainFrame && type == .microphone && trusted(frame.request.url)
                && origin.protocol == "https" && origin.host == self.origin.host && primaryPort == (self.origin.port ?? 443)
            decisionHandler(allowed ? .prompt : .deny)
        }

        func stop() {
            token = nil
            subscription?.cancel()
            subscription = nil
            dictation.stop()
        }

        private func update(id: String, text: String, active: Bool, failed: Bool) {
            guard token == id else { return }
            if active { started = true }
            if started && text != last && !text.isEmpty {
                last = text
                send(["id": id, "text": text])
            }
            if !active && (started || failed) {
                token = nil
                subscription?.cancel()
                subscription = nil
                send(["id": id, "status": failed ? "failed" : "done"])
            }
        }

        private func send(_ event: [String: String]) {
            guard let json = try? JSONEncoder().encode(event), let text = String(data: json, encoding: .utf8) else { return }
            view?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('startupbot-mobile-dictation', {detail: \(text)}))")
        }
    }
}
