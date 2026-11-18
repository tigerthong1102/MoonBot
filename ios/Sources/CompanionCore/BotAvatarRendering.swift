// Modified for StartupBot; original copyright and license retained.
import Foundation

public enum BotAvatarOutcome: String, CaseIterable, Hashable, Sendable {
    case flatImage
    case gradientMascot
}

public func resolveBotAvatarOutcome(
    crop: AvatarCrop,
    hasUrl: Bool,
    imageDecoded: Bool,
    failed: Bool
) -> BotAvatarOutcome {
    guard hasUrl, crop != .mascot else { return .gradientMascot }
    guard imageDecoded, !failed else { return .gradientMascot }
    return .flatImage
}

extension AvatarCrop {
    public static func afterGenerating(
        cropAtStart: AvatarCrop,
        latestCrop: AvatarCrop,
        serverCrop: AvatarCrop?
    ) -> AvatarCrop {
        latestCrop != cropAtStart ? latestCrop : (serverCrop ?? .circle)
    }
}
