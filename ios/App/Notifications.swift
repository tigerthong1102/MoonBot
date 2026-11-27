// Modified for StartupBot; original copyright and license retained.
import Foundation
import UserNotifications
import CompanionCore

final class NotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCoordinator()
    private let center = UNUserNotificationCenter.current()
    var responseHandler: ((NotificationTarget) -> Void)?

    private override init() {
        super.init()
        center.delegate = self
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true
    }

    func deliver(_ notification: NotificationFrame, sequence: Int?, connectionID: String, computerName: String) {
        center.add(Self.request(notification, sequence: sequence, connectionID: connectionID, computerName: computerName))
    }

    static func request(_ notification: NotificationFrame, sequence: Int?, connectionID: String, computerName: String = "") -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.subtitle = String(computerName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        content.title = notification.title
        content.body = notification.body
        content.sound = .default
        content.categoryIdentifier = notification.isBlocking ? "STARTUPBOT_APPROVAL" : "STARTUPBOT_UPDATE"
        let scope = [connectionID, notification.threadId].map { Data($0.utf8).base64EncodedString() }.joined(separator: ".")
        content.threadIdentifier = "startupbot.\(scope)"
        content.userInfo = [
            "threadId": notification.threadId,
            "botId": notification.botId,
            "kind": notification.kind,
            "connectionId": connectionID,
        ]
        if notification.isBlocking { content.interruptionLevel = .timeSensitive }

        let event = sequence.map { "seq:\($0)" } ?? "title:\(Data(notification.title.utf8).base64EncodedString())"
        return UNNotificationRequest(identifier: "\(content.threadIdentifier).\(event)", content: content, trigger: nil)
    }

    func setBadge(_ count: Int) {
        center.setBadgeCount(max(0, count))
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let strings = response.notification.request.content.userInfo.reduce(into: [String: String]()) { result, pair in
            guard let key = pair.key as? String, let value = pair.value as? String else { return }
            result[key] = value
        }
        if let target = NotificationTarget(payload: strings) { responseHandler?(target) }
        completionHandler()
    }
}
