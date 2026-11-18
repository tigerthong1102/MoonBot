// Modified for StartupBot; original copyright and license retained.
// An avatar attachment that carries more than one frame, decoded into the
// uniform-tick form UIKit can play.
//
// `UIImage(data:)` keeps only the first frame, so an animated GIF or WebP
// avatar renders as a still on the phone while the desktop — which draws the
// same URL into an `<img>` — plays it. The server already accepts these:
// `botAvatarUrlSchema` allows png, jpg, gif and webp.
//
// The decode lives here rather than in the view because ImageIO is available
// on macOS too, so `swift test` covers the timing rules below without Xcode,
// a simulator, or signing.
import CoreGraphics
import Foundation
import ImageIO

public struct AnimatedImage {
    /// Frames in play order, already expanded so that every entry is shown
    /// for the same tick. UIKit plays `UIImage.animatedImage(with:duration:)`
    /// at a uniform rate, so a frame held twice as long as its neighbour is
    /// represented as two entries rather than one longer one.
    public let frames: [CGImage]

    public let duration: TimeInterval

    public var tick: TimeInterval { frames.isEmpty ? 0 : duration / Double(frames.count) }
}

public enum AnimatedImageDecoder {
    static let defaultDelay: TimeInterval = 0.1

    static let minimumHonouredDelay: TimeInterval = 0.011

    static let sourceFrameLimit = 240
    static let expandedFrameLimit = 600

    static let maximumFramePixelSize = 256

    private static let timingKeys: [(container: CFString, unclamped: CFString, clamped: CFString)] = [
        (kCGImagePropertyGIFDictionary, kCGImagePropertyGIFUnclampedDelayTime, kCGImagePropertyGIFDelayTime),
        (kCGImagePropertyPNGDictionary, kCGImagePropertyAPNGUnclampedDelayTime, kCGImagePropertyAPNGDelayTime),
        (kCGImagePropertyWebPDictionary, kCGImagePropertyWebPUnclampedDelayTime, kCGImagePropertyWebPDelayTime),
        (kCGImagePropertyHEICSDictionary, kCGImagePropertyHEICSUnclampedDelayTime, kCGImagePropertyHEICSDelayTime),
    ]

    public static func decode(_ data: Data) -> AnimatedImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let available = CGImageSourceGetCount(source)
        guard available > 1 else { return nil }

        let count = min(available, sourceFrameLimit)
        var frames: [CGImage] = []
        var delays: [TimeInterval] = []
        frames.reserveCapacity(count)
        delays.reserveCapacity(count)

        // ImageIO applies EXIF orientation while producing the thumbnail, so
        // UIKit receives consistently upright frames without a second full-
        // resolution allocation.
        let thumbnailOptions: CFDictionary = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumFramePixelSize,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary

        for index in 0..<count {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(
                source, index, thumbnailOptions
            ) else { continue }
            frames.append(frame)
            delays.append(delay(at: index, in: source))
        }

        guard frames.count > 1 else { return nil }
        return expand(frames: frames, delays: delays)
    }

    private static func expand(frames: [CGImage], delays: [TimeInterval]) -> AnimatedImage? {
        let tick = max(delays.min() ?? defaultDelay, minimumHonouredDelay)
        var expanded: [CGImage] = []
        expanded.reserveCapacity(frames.count)

        for (frame, delay) in zip(frames, delays) {
            let repeats = max(1, Int((delay / tick).rounded()))
            for _ in 0..<repeats {
                expanded.append(frame)
                if expanded.count >= expandedFrameLimit { break }
            }
            if expanded.count >= expandedFrameLimit { break }
        }

        guard expanded.count > 1 else { return nil }
        return AnimatedImage(frames: expanded, duration: tick * Double(expanded.count))
    }

    private static func delay(at index: Int, in source: CGImageSource) -> TimeInterval {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any] else {
            return defaultDelay
        }

        for keys in timingKeys {
            guard let container = properties[keys.container] as? [CFString: Any] else { continue }
            for key in [keys.unclamped, keys.clamped] {
                guard let value = container[key] as? Double else { continue }
                if value >= minimumHonouredDelay { return value }
            }
            return defaultDelay
        }

        return defaultDelay
    }
}
