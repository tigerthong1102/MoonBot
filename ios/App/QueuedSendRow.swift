// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import CompanionCore

struct QueuedSendRow: View {
    let send: QueuedSend
    let onSteer: (() -> Void)?
    var isSteering = false
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.secondary)

            Text(send.text)
                .font(.system(size: 15))
                .foregroundStyle(Color.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let onSteer {
                Button(action: onSteer) {
                    HStack(spacing: 4) {
                        if isSteering {
                            ProgressView().controlSize(.mini)
                            Text("Steering…")
                                .font(.system(size: 14, weight: .medium))
                        } else {
                            Image(systemName: "arrow.turn.down.right")
                                .font(.system(size: 11, weight: .bold))
                            Text("Steer")
                                .font(.system(size: 14, weight: .medium))
                        }
                    }
                    .foregroundStyle(Color.primary)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Color.secondary.opacity(isSteering ? 0.12 : 0.22)))
                }
                .buttonStyle(.plain)
                .disabled(isSteering)
                .accessibilityLabel(isSteering ? "Steering" : "Steer")
                .accessibilityHint("Stops the current turn so this message runs now")
            }

            Button(action: onCancel) {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete this queued message")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.secondary.opacity(0.14))
        )
    }
}
