import SwiftUI
import CompanionCore

struct AiTwinView: View {
    @EnvironmentObject private var session: Session
    @State private var status: AiTwinStatus?
    @State private var question = ""
    @State private var answer: AiTwinAnswer?
    @State private var action: AiTwinAction?
    @State private var loading = true
    @State private var failed = false
    @State private var retry = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Form {
            if loading {
                ProgressView()
            } else if let twin = status?.twin, !twin.paused {
                Section {
                    TextField("Ask AI Twin", text: $question, axis: .vertical)
                        .lineLimit(2...4)
                        .disabled(action != nil)
                    Button("Look up a lesson") { action = .exact }
                        .disabled(!canAsk)
                    if let provider = status?.preview {
                        Button("Look up by meaning") { action = .semantic }
                            .disabled(!canAsk)
                        Button("Draft with memory") { action = .draft }
                            .disabled(!canAsk)
                        Text("AI uses \(provider.name) (\(provider.model)). Lookup can share lesson questions. Drafting may also share a matched answer and writing habits.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text(verbatim: twin.name)
                }
                if action != nil { ProgressView() }
                if failed {
                    Text("AI Twin could not answer. Refresh and try again.")
                    Button("Refresh") { retry += 1 }
                }
                if let answer {
                    if let lesson = answer.lesson {
                        Section {
                            Text(verbatim: lesson.question).fontWeight(.semibold)
                            Text(verbatim: lesson.answer).textSelection(.enabled)
                        } header: {
                            Text(answer.match == "semantic" ? LocalizedStringKey("Possible lesson match") : "Approved lesson")
                        }
                    } else if answer.draft == nil {
                        Text("No matching lesson.")
                    }
                    if let draft = answer.draft {
                        Section("Private draft") { Text(verbatim: draft).textSelection(.enabled) }
                    }
                }
            } else {
                if status?.twin?.paused == true {
                    Text("AI Twin is paused.")
                } else {
                    Text("Open AI Twin on the paired computer to allow phone access, or create a Twin in your personal Cloud.")
                }
                Button("Refresh") { retry += 1 }
            }
        }
        .navigationTitle("AI Twin")
        .task(id: retry) {
            loading = true
            answer = nil
            let refreshed = await session.aiTwin()
            guard !Task.isCancelled else { return }
            status = refreshed
            failed = false
            loading = false
        }
        .task(id: action) {
            guard let action, let twin = status?.twin else { return }
            answer = nil
            failed = false
            let result = await session.askAiTwin(twin, question: question, action: action, provider: status?.preview)
            guard !Task.isCancelled else { return }
            answer = result
            failed = result == nil
            self.action = nil
        }
        .onChange(of: question) { _, _ in answer = nil }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                action = nil
                answer = nil
                question = ""
                status = nil
            } else if phase == .active, status == nil {
                retry += 1
            }
        }
    }

    private var canAsk: Bool {
        action == nil && !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && question.utf16.count <= 1_000
    }
}
