import Darwin
import Foundation

// Redirect targets must not receive pairing credentials or authenticated request bodies.
final class CompanionRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = CompanionRedirectPolicy()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

extension Connection {
    var serverTransportAllowed: Bool {
        guard let origin = baseURL, var host = origin.host?.lowercased() else { return false }
        if origin.scheme == "https" { return true }
        host = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]."))
        if host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".ts.net") { return true }
        let literal = String(host.split(separator: "%", maxSplits: 1).first ?? "")
        if literal.contains(":") {
            var address = in6_addr()
            guard inet_pton(AF_INET6, literal, &address) == 1 else { return false }
            let bytes = withUnsafeBytes(of: address) { Array($0) }
            return bytes == Array(repeating: 0, count: 15) + [1] ||
                bytes[0] & 0xfe == 0xfc || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80)
        }
        let parts = literal.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }),
              parts.allSatisfy({ Int($0).map { (0...255).contains($0) } == true }) else { return false }
        let octets = parts.compactMap { Int($0) }
        return octets[0] == 127 || octets[0] == 10 ||
            (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 169 && octets[1] == 254)
    }

    func requireServerTransport() throws {
        guard serverTransportAllowed else {
            throw APIError.transport("Use HTTPS or a Tailscale address for a remote server. HTTP is only supported for local addresses.")
        }
    }
}
