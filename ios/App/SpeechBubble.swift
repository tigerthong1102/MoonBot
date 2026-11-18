// Modified for StartupBot; original copyright and license retained.
import SwiftUI

struct SpeechBubble: Shape {
    enum Tail { case none, leading, trailing }

    var tail: Tail = .none
    var cornerRadius: CGFloat = 22

    static func tailDrop(cornerRadius: CGFloat = 22) -> CGFloat {
        cornerRadius / referenceCapRadius * referenceTailDrop
    }

    private static let referenceCapRadius: CGFloat = 179
    private static let referenceTailDrop: CGFloat = 68
    private static let referenceOrigin = CGPoint(x: 766.342, y: 361.317)
    private static let referenceTail: [(CGPoint, CGPoint, CGPoint)] = [
        (CGPoint(x: 766.342, y: 249.767), CGPoint(x: 727.342, y: 299.817), CGPoint(x: 699.842, y: 323.317)),
        (CGPoint(x: 699.842, y: 323.317), CGPoint(x: 677.085, y: 338.817), CGPoint(x: 674.342, y: 354.817)),
        (CGPoint(x: 668.342, y: 389.817), CGPoint(x: 700.829, y: 410.817), CGPoint(x: 691.829, y: 421.317)),
        (CGPoint(x: 684.629, y: 429.717), CGPoint(x: 615.056, y: 378.235), CGPoint(x: 580.342, y: 361.317)),
    ]

    func path(in rect: CGRect) -> Path {
        let r = min(cornerRadius, rect.height / 2, rect.width / 2)
        guard tail != .none else {
            return RoundedRectangle(cornerRadius: r, style: .continuous).path(in: rect)
        }
        var path = trailingTailPath(in: rect, radius: r)
        if tail == .leading {
            let flip = CGAffineTransform(translationX: rect.minX + rect.maxX, y: 0).scaledBy(x: -1, y: 1)
            path = path.applying(flip)
        }
        return path
    }

    private func trailingTailPath(in rect: CGRect, radius r: CGFloat) -> Path {
        let s = r / Self.referenceCapRadius
        let origin = CGPoint(x: rect.maxX, y: rect.maxY)
        func map(_ p: CGPoint) -> CGPoint {
            CGPoint(x: origin.x + (p.x - Self.referenceOrigin.x) * s, y: origin.y + (p.y - Self.referenceOrigin.y) * s)
        }

        var path = Path()
        path.move(to: CGPoint(x: rect.minX + r, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        path.addArc(
            center: CGPoint(x: rect.maxX - r, y: rect.minY + r), radius: r,
            startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        for (c1, c2, end) in Self.referenceTail {
            path.addCurve(to: map(end), control1: map(c1), control2: map(c2))
        }
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addArc(
            center: CGPoint(x: rect.minX + r, y: rect.maxY - r), radius: r,
            startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
        path.addArc(
            center: CGPoint(x: rect.minX + r, y: rect.minY + r), radius: r,
            startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

enum BubbleColor {
    static let mine = MausPalette.color("blue")
    static let mineText = Color.white

    static let theirs = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.149, green: 0.149, blue: 0.161, alpha: 1)
            : UIColor(red: 0.914, green: 0.914, blue: 0.922, alpha: 1)
    })
}
