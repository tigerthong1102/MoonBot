// Modified for StartupBot; original copyright and license retained.
public enum RoomCouncilMode: Sendable {
    case off
    case independent
    case critique

    public func message(_ question: String) -> String {
        switch self {
        case .off: question
        case .independent: "/council \(question)"
        case .critique: "/council --critique \(question)"
        }
    }
}
