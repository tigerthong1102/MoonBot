// Modified for StartupBot; original copyright and license retained.
// SSE frames contain an id and data separated by a blank line; colon-prefixed lines are keepalives.
import Foundation
import OSLog

private let log = Logger(subsystem: "ai.startupbot.companion", category: "stream")

public struct SSEEvent: Equatable, Sendable {
    public var id: String?
    public var data: String

    public init(id: String? = nil, data: String) {
        self.id = id
        self.data = data
    }
}

public struct SSEParser: Sendable {
    private var fields: [(name: String, value: String)] = []

    public init() {}

    public mutating func line(_ raw: String) -> SSEEvent? {
        let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw

        guard !line.isEmpty else {
            let event = Self.event(from: fields)
            fields.removeAll()
            return event
        }
        guard !line.hasPrefix(":") else { return nil }
        guard let colon = line.firstIndex(of: ":") else {
            return nil
        }
        var value = String(line[line.index(after: colon)...])
        if value.hasPrefix(" ") { value.removeFirst() }
        fields.append((name: String(line[line.startIndex..<colon]), value: value))
        return nil
    }

    public mutating func reset() {
        fields.removeAll()
    }

    static func event(from fields: [(name: String, value: String)]) -> SSEEvent? {
        var id: String?
        var dataLines: [String] = []
        for field in fields {
            switch field.name {
            case "data": dataLines.append(field.value)
            case "id": id = field.value
            default: break
            }
        }
        guard !dataLines.isEmpty else { return nil }
        return SSEEvent(id: id, data: dataLines.joined(separator: "\n"))
    }
}

struct SSEReadBudget {
    let maximumBytes: Int
    private var eventBytes = 0

    init(maximumBytes: Int = 8 * 1024 * 1024) { self.maximumBytes = maximumBytes }

    mutating func accept(_ line: String) throws {
        let count = line.utf8.count
        guard count <= maximumBytes else { throw APIError.transport("The event stream exceeds this phone's safety limit.") }
        if line.isEmpty { eventBytes = 0 }
        else if !line.hasPrefix(":") {
            guard count < maximumBytes - eventBytes else { throw APIError.transport("The event stream exceeds this phone's safety limit.") }
            eventBytes += count + 1
        }
    }
}

public func eventStream(
    request: URLRequest,
    session: URLSession = .shared,
    beforeConnect: @escaping @Sendable () async throws -> Void = {}
) -> AsyncThrowingStream<StreamFrame, Error> {
    AsyncThrowingStream(bufferingPolicy: .bufferingOldest(64)) { continuation in
        let task = Task {
            do {
                try await beforeConnect()
                let (bytes, response) = try await session.bytes(for: request, delegate: CompanionRedirectPolicy.shared)
                defer { bytes.task.cancel() }
                if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                    throw APIError.status(code: http.statusCode, message: nil)
                }

                var parser = SSEParser()
                var budget = SSEReadBudget()
                let decoder = JSONDecoder()
                var line = [UInt8]()

                // SSE requires the empty line between frames; AsyncLineSequence skips empty lines.
                for try await byte in bytes {
                    guard byte == 0x0A else {
                        guard line.count < budget.maximumBytes else { throw APIError.transport("The event stream exceeds this phone's safety limit.") }
                        line.append(byte)
                        continue
                    }
                    if line.last == 0x0D { line.removeLast() }
                    let text = String(decoding: line, as: UTF8.self)
                    line.removeAll(keepingCapacity: true)

                    try budget.accept(text)
                    guard let event = parser.line(text) else { continue }
                    guard let data = event.data.data(using: .utf8) else { continue }
                    guard let frame = try? decoder.decode(StreamFrame.self, from: data) else {
                        var kind = "unknown"
                        if let object = try? JSONSerialization.jsonObject(with: data),
                           let fields = object as? [String: Any],
                           let named = fields["kind"] as? String {
                            kind = named
                        }
                        log.error("dropped an undecodable frame (kind: \(kind, privacy: .public))")
                        continue
                    }
                    switch continuation.yield(frame) {
                    case .enqueued: break
                    case .dropped: throw APIError.transport("The event stream consumer fell behind. Reconnecting from the last received event.")
                    case .terminated: return
                    @unknown default: return
                    }
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}
