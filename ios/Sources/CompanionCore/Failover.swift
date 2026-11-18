// Modified for StartupBot; original copyright and license retained.
// A protected connection must not fall back to an unapproved cleartext route.
import Foundation

public struct CandidateRotation: Equatable, Sendable {
    public private(set) var endpoints: [CompanionEndpoint]
    private var index: Int

    public init(hosts: [String]) {
        self.init(endpoints: hosts.enumerated().compactMap { offset, host in
            CompanionEndpoint.direct(host: host, port: 8810, priority: offset)
        })
    }

    public init(endpoints: [CompanionEndpoint]) {
        self.endpoints = CompanionEndpoint.automaticCandidates(from: endpoints)
        index = 0
    }

    public var hosts: [String] { endpoints.map(\.displayAddress) }

    public var currentEndpoint: CompanionEndpoint? {
        endpoints.indices.contains(index) ? endpoints[index] : nil
    }

    public var current: String {
        currentEndpoint?.displayAddress ?? ""
    }

    public var count: Int { endpoints.count }

    @discardableResult
    public mutating func advance() -> String {
        advanceEndpoint()?.displayAddress ?? ""
    }

    @discardableResult
    public mutating func advanceEndpoint() -> CompanionEndpoint? {
        guard !endpoints.isEmpty else { return nil }
        index = (index + 1) % endpoints.count
        guard let next = currentEndpoint else { return nil }
        // An explicit local route may upgrade to a protected route, but that
        // upgrade is one-way. Pruning the local route prevents a later wrap
        // from silently downgrading the bearer transport again.
        if next.protectsCredentials,
           endpoints.contains(where: { !$0.protectsCredentials }) {
            let selectedURL = next.url
            endpoints.removeAll { !$0.protectsCredentials }
            index = endpoints.firstIndex(where: { $0.url == selectedURL }) ?? 0
        }
        return currentEndpoint
    }

    @discardableResult
    public mutating func advanceEndpoint(after error: Error) -> CompanionEndpoint? {
        guard endpoints.count > 1,
              ConnectionAdvice.shouldTryAnotherRoute(after: error)
        else { return nil }
        return advanceEndpoint()
    }

    public func promotedEndpoints() -> [CompanionEndpoint] {
        guard endpoints.indices.contains(index) else { return endpoints }
        return [endpoints[index]] + endpoints.enumerated()
            .filter { $0.offset != index }
            .map(\.element)
    }

    public func promoted() -> [String] {
        promotedEndpoints().map(\.displayAddress)
    }
}

public enum ConnectionAdvice {
    // Unauthorized credentials must not trigger an address failover.
    public static func shouldTryAnotherHost(_ code: URLError.Code) -> Bool {
        switch code {
        case .cannotFindHost,
             .cannotConnectToHost,
             .timedOut,
             .secureConnectionFailed,
             .serverCertificateHasBadDate,
             .serverCertificateUntrusted,
             .serverCertificateHasUnknownRoot,
             .serverCertificateNotYetValid,
             .clientCertificateRejected,
             .clientCertificateRequired:
            return true
        default:
            return false
        }
    }

    public static func shouldTryAnotherRoute(after error: Error) -> Bool {
        if let urlError = error as? URLError {
            return shouldTryAnotherHost(urlError.code)
        }
        guard let apiError = error as? APIError,
              case let .status(code, _) = apiError
        else { return false }
        return (502...504).contains(code) || (520...530).contains(code)
    }

    public static func message(
        for code: URLError.Code,
        host: String,
        port: Int,
        tryingNext next: String? = nil
    ) -> String {
        let advice: String
        switch code {
        case .cannotFindHost:
            advice = "\u{201C}\(host)\u{201D} didn't resolve. If that's a Tailscale name, this phone may not be on the tailnet."
        case .cannotConnectToHost:
            advice = "Reached your computer, but Phone access isn't answering on port \(port) — open StartupBot → Settings → Phone."
        case .timedOut:
            advice = "No route to your computer at \(host) — different network, or a firewall."
        case .notConnectedToInternet:
            advice = "You're offline."
        default:
            advice = "Could not reach \(host): \(URLError(code).localizedDescription)"
        }
        let fallback = next.map { " Trying \($0) next." } ?? ""
        return advice + fallback + " The app keeps retrying automatically."
    }

    public static func message(
        forGatewayStatus code: Int,
        host: String,
        tryingNext next: String? = nil
    ) -> String {
        let fallback = next.map { " Trying \($0) next." } ?? ""
        return "The route through \(host) is temporarily unavailable (HTTP \(code))." +
            fallback + " The app keeps retrying automatically."
    }
}

extension Connection {
    /// `nil` is the compatibility policy for connections persisted before
    /// route consent existed. Once a policy is present, only an explicitly
    /// selected kind and hosted HTTPS may receive the pairing/device token.
    public func allowsRouteKind(_ kind: CompanionEndpointKind) -> Bool {
        guard let allowedRouteKinds else { return true }
        return kind == .hosted || allowedRouteKinds.contains(kind)
    }

    // Cleartext routes require consent to the exact origin; the network kind alone is insufficient.
    public func allowsEndpoint(_ endpoint: CompanionEndpoint) -> Bool {
        guard allowsRouteKind(endpoint.kind) else { return false }
        guard endpoint.securityClass == .explicitLocal,
              allowedRouteKinds != nil
        else { return true }
        return allowedLocalRouteURLs?.contains(endpoint.url) == true
    }

    public func endpointsAllowedByRoutePolicy(
        _ candidates: [CompanionEndpoint]
    ) -> [CompanionEndpoint] {
        candidates.filter(allowsEndpoint)
    }

    // Advisory fallback addresses do not grant consent to transmit a pairing credential over them.
    public mutating func establishRoutePolicyFromInvite() {
        let selected = activeEndpoint ?? CompanionEndpoint.direct(
            host: host,
            port: port,
            priority: 0
        )
        switch selected {
        case let endpoint? where endpoint.kind == .hosted:
            allowedRouteKinds = [.hosted]
            allowedLocalRouteURLs = []
        case let endpoint? where endpoint.kind == .tailnet:
            allowedRouteKinds = [.tailnet, .hosted]
            allowedLocalRouteURLs = []
        case let endpoint?:
            allowedRouteKinds = [endpoint.kind, .hosted]
            allowedLocalRouteURLs = [endpoint.url]
        case nil:
            allowedRouteKinds = [.hosted]
            allowedLocalRouteURLs = []
        }
        if let endpoints {
            self.endpoints = Array(endpointsAllowedByRoutePolicy(endpoints).prefix(8))
        }
        if let hosts {
            self.hosts = Array(advertisedHostsAllowedByRoutePolicy(hosts).prefix(8))
        }
    }

    /// Apply the routes returned when a pairing credential is redeemed. The
    /// response may advertise every interface on the Mac, but it cannot widen
    /// the consent recorded from the invite which carried that credential.
    public mutating func applyPairingAdvertisement(
        hosts advertisedHosts: [String]?,
        endpoints advertisedEndpoints: [CompanionEndpoint]?
    ) {
        if let advertisedHosts, !advertisedHosts.isEmpty {
            hosts = Array(advertisedHostsAllowedByRoutePolicy(advertisedHosts).prefix(8))
        }
        if let advertisedEndpoints, !advertisedEndpoints.isEmpty {
            let accepted = endpointsAllowedByRoutePolicy(advertisedEndpoints)
            if !accepted.isEmpty { endpoints = Array(accepted.prefix(8)) }
        }
    }

    // An address entered by the user grants fresh consent without widening the previous route policy.
    public mutating func resetRoutePolicy(selecting endpoint: CompanionEndpoint) {
        let previousEndpoints = orderedEndpoints
        allowedRouteKinds = [endpoint.kind, .hosted]
        allowedLocalRouteURLs = endpoint.securityClass == .explicitLocal ? [endpoint.url] : []
        activeEndpoint = endpoint
        host = endpoint.host
        port = endpoint.port
        endpoints = [endpoint] + endpointsAllowedByRoutePolicy(previousEndpoints)
            .filter { $0.url != endpoint.url }
        hosts = Array(advertisedHostsAllowedByRoutePolicy(
            [endpoint.host] + (hosts ?? [])
        ).prefix(8))
    }

    private func advertisedHostsAllowedByRoutePolicy(_ candidates: [String]) -> [String] {
        var seen = Set<String>()
        return candidates.compactMap { raw -> String? in
            let candidate = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !candidate.isEmpty,
                  candidate.utf8.count <= 253,
                  !candidate.contains(where: { $0.isWhitespace || "/?#".contains($0) })
            else { return nil }
            let normalized = Self.urlHost(candidate)
            guard let endpoint = CompanionEndpoint.direct(
                host: normalized,
                port: port,
                priority: 0
            ), allowsEndpoint(endpoint) else { return nil }
            return seen.insert(normalized).inserted ? normalized : nil
        }
    }

    public var orderedHosts: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for candidate in [host] + (hosts ?? []) {
            let normalized = Self.urlHost(candidate)
            guard let endpoint = CompanionEndpoint.direct(
                host: normalized,
                port: port,
                priority: 0
            ), allowsEndpoint(endpoint) else {
                continue
            }
            if seen.insert(normalized).inserted { out.append(normalized) }
        }
        return out
    }


    public var orderedEndpoints: [CompanionEndpoint] {
        var candidates = endpoints ?? []
        if !candidates.isEmpty {
            if let activeEndpoint, !candidates.contains(where: { $0.url == activeEndpoint.url }) {
                candidates.append(activeEndpoint)
            }
            // An unconsented cleartext route cannot trigger promotion of another route.
            candidates = endpointsAllowedByRoutePolicy(candidates).enumerated().sorted {
                $0.element.priority == $1.element.priority
                    ? $0.offset < $1.offset
                    : $0.element.priority < $1.element.priority
            }.map(\.element)
            if let activeEndpoint = activeEndpoint.flatMap({ active in
                candidates.first(where: { $0.url == active.url })
            }), activeEndpoint.protectsCredentials,
               let sortedHead = candidates.first, !sortedHead.protectsCredentials {
                candidates = [activeEndpoint] + candidates.filter { $0.url != activeEndpoint.url }
            }
        } else {
            candidates = orderedHosts.enumerated().compactMap { offset, candidate in
                CompanionEndpoint.direct(host: candidate, port: port, priority: offset)
            }
        }
        var seen = Set<String>()
        return endpointsAllowedByRoutePolicy(candidates)
            .filter { seen.insert($0.url).inserted }
            .prefix(8).map { $0 }
    }

    /// The subset an automatic pairing or authenticated reconnect may try.
    /// A policy-bound connection first removes route kinds the person did not
    /// select; the transport ratchet then removes unsafe cleartext fallbacks.
    public var automaticEndpoints: [CompanionEndpoint] {
        CompanionEndpoint.automaticCandidates(from: orderedEndpoints)
    }


    public mutating func reconcile(_ metadata: CompanionConnectionMetadata) {
        let cleanedName = metadata.serverName.trimmingCharacters(in: .whitespacesAndNewlines)
            .filter { (!$0.isASCII && !$0.isNewline) || $0.asciiValue.map { $0 >= 32 && $0 != 127 } == true }
        if !cleanedName.isEmpty { name = String(cleanedName.prefix(80)) }

        if let advertisedHosts = metadata.hosts {
            hosts = Array(advertisedHostsAllowedByRoutePolicy(advertisedHosts).prefix(8))
        }

        let previousActive = activeEndpoint.flatMap { allowsEndpoint($0) ? $0 : nil }
        let refreshedEndpoints = endpointsAllowedByRoutePolicy(metadata.endpoints)
        endpoints = refreshedEndpoints
        if let previousActive,
           let refreshedActive = refreshedEndpoints.first(where: { $0.url == previousActive.url }) {
            activeEndpoint = refreshedActive
        } else if let protectedReplacement = refreshedEndpoints.first(where: \.protectsCredentials) {
            activeEndpoint = protectedReplacement
        } else if let previousActive,
                  let retained = CompanionEndpoint(
                      url: previousActive.url,
                      kind: previousActive.kind,
                      priority: 0
                  ) {
            activeEndpoint = retained
            endpoints = [retained] + refreshedEndpoints
                .filter { $0.url != retained.url }
                .prefix(7)
        } else {
            activeEndpoint = refreshedEndpoints.first
        }
        if let activeEndpoint {
            host = activeEndpoint.host
            port = activeEndpoint.port
        }
    }

    public func dialing(_ candidate: String) -> Connection {
        guard let endpoint = CompanionEndpoint.direct(host: candidate, port: port, priority: 10_000) else {
            return self
        }
        return dialing(endpoint)
    }

    /// A copy dialing one complete route without changing its stored policy
    /// order or keychain identity.
    public func dialing(_ candidate: CompanionEndpoint) -> Connection {
        guard allowsEndpoint(candidate) else { return self }
        var copy = self
        copy.activeEndpoint = candidate
        copy.host = candidate.host
        copy.port = candidate.port
        return copy
    }

    public mutating func promote(_ winner: String) {
        let normalized = Self.urlHost(winner)
        guard let endpoint = CompanionEndpoint.direct(
            host: normalized,
            port: port,
            priority: 10_000
        ), allowsEndpoint(endpoint) else { return }
        let rest = orderedHosts.filter { $0 != normalized }
        host = normalized
        hosts = [normalized] + rest
        activeEndpoint = endpoint
    }

    // Cleartext fallback cannot outrank a protected hosted or tailnet route.
    public mutating func promote(_ winner: CompanionEndpoint) {
        guard allowsEndpoint(winner) else { return }
        activeEndpoint = winner
        host = winner.host
        port = winner.port
        if let existing = endpoints,
           !existing.contains(where: { $0.url == winner.url }) {
            endpoints = existing + [winner]
        }
        if winner.kind != .hosted {
            let rest = orderedHosts.filter { $0 != winner.host }
            hosts = [winner.host] + rest
        }
    }
}
