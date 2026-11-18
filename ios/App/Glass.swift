// Modified for StartupBot; original copyright and license retained.
import SwiftUI

struct GlassSurface<S: InsettableShape>: ViewModifier {
    let shape: S
    var interactive: Bool = true
    var tint: Color? = nil

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            let base: Glass = interactive ? .regular.interactive() : .regular
            content.glassEffect(tint.map { base.tint($0) } ?? base, in: shape)
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .background(tint?.opacity(0.18) ?? .clear, in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.10), lineWidth: 0.5))
        }
    }
}

extension View {
    func glassCapsule(interactive: Bool = true, tint: Color? = nil) -> some View {
        modifier(GlassSurface(shape: Capsule(), interactive: interactive, tint: tint))
    }

    func glassSheet(cornerRadius: CGFloat = 28, tint: Color? = nil) -> some View {
        modifier(GlassSurface(
            shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
            interactive: false,
            tint: tint
        ))
    }
}

/// Neighbouring glass merges when it touches, the way it does in the
/// system's own bars. A no-op before iOS 26.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 8
    @ViewBuilder let content: () -> Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing, content: content)
        } else {
            content()
        }
    }
}

struct GlassButton: View {
    let systemImage: String
    var size: CGFloat = 44
    var weight: Font.Weight = .medium
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.42, weight: weight))
                .foregroundStyle(Color.primary)
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassCapsule()
    }
}
