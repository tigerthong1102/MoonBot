// Modified for StartupBot; original copyright and license retained.
import CoreGraphics
import Foundation

public enum MausSilhouette {
    public static func usesDefaultBody(_ id: String?) -> Bool { MausBodies.body(id).id == MausBodies.defaultID }

    public static let faceBox: CGFloat = 228.541

    public static let defaultBody: String = MausBodies.defaultID

    private struct Placed {
        let path: CGPath
        let bounds: CGRect
    }

    private static var cache: [String: Placed] = [:]
    private static let lock = NSLock()

    public static func inFaceBox(_ id: String?) -> CGPath {
        placed(id).path
    }

    public static func faceBoxBounds(_ id: String?) -> CGRect {
        placed(id).bounds
    }

    public static func anchor(_ id: String?) -> (x: CGFloat, y: CGFloat, scale: CGFloat) {
        MausBodies.body(id).anchor
    }

    private static func placed(_ id: String?) -> Placed {
        let body = MausBodies.body(id)
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[body.id] { return cached }
        var transform = CGAffineTransform(scaleX: body.fit.scale, y: body.fit.scale)
            .concatenating(CGAffineTransform(translationX: body.fit.tx, y: body.fit.ty))
        let parsed = parse(body.path)
        let path = parsed.copy(using: &transform) ?? parsed
        let result = Placed(path: path, bounds: path.boundingBoxOfPath)
        cache[body.id] = result
        return result
    }

    static func parse(_ data: String) -> CGPath {
        let raw = CGMutablePath()
        var numbers: [CGFloat] = []
        var command: Character?

        func flush() {
            guard let command else { return }
            switch command {
            case "M":
                guard numbers.count >= 2 else { break }
                raw.move(to: CGPoint(x: numbers[0], y: numbers[1]))
            case "C":
                var i = 0
                while i + 5 < numbers.count {
                    raw.addCurve(
                        to: CGPoint(x: numbers[i + 4], y: numbers[i + 5]),
                        control1: CGPoint(x: numbers[i], y: numbers[i + 1]),
                        control2: CGPoint(x: numbers[i + 2], y: numbers[i + 3])
                    )
                    i += 6
                }
            default:
                break
            }
            numbers.removeAll()
        }

        var token = ""
        func takeNumber() {
            if !token.isEmpty, let value = Double(token) { numbers.append(CGFloat(value)) }
            token = ""
        }

        for character in data {
            if character.isNumber || character == "." || character == "e" {
                token.append(character)
            } else if character == "-" {
                if token.hasSuffix("e") { token.append(character) } else { takeNumber(); token = "-" }
            } else if character == " " || character == "," || character == "\n" {
                takeNumber()
            } else if character == "Z" || character == "z" {
                takeNumber()
                flush()
                if !raw.isEmpty { raw.closeSubpath() }
                command = nil
            } else {
                takeNumber()
                flush()
                command = character
            }
        }
        takeNumber()
        flush()
        return raw
    }
}
