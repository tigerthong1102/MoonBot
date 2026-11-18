import SwiftUI
import CompanionCore

struct StructuredQuestionCardView: View {
    let chat: Chat
    let card: OptionCard
    let request: QuestionRequestCardData
    @EnvironmentObject private var session: Session
    @State private var form = QuestionAnswerForm()
    @State private var answering = false
    @State private var sent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if request.isSupported {
                ForEach(request.questions.indices, id: \.self) { index in
                    let question = request.questions[index]
                    VStack(alignment: .leading, spacing: 8) {
                        Text(question.header ?? "Question \(index + 1)").font(.caption).foregroundStyle(.secondary)
                        Text(question.question).font(.body).fixedSize(horizontal: false, vertical: true)
                        ForEach(question.options, id: \.label) { option in
                            Button {
                                form.choose(option.label, at: index, in: request)
                            } label: {
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: form.selected[index]?.contains(option.label) == true ? "checkmark.circle.fill" : "circle")
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(option.label)
                                        if let detail = option.description { Text(detail).font(.caption).foregroundStyle(.secondary) }
                                    }
                                    Spacer(minLength: 0)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(option.label)
                            .accessibilityValue(form.selected[index]?.contains(option.label) == true ? "Selected" : "Not selected")
                        }
                        if question.allowsCustom {
                            TextField("Other answer", text: Binding(
                                get: { form.custom[index] ?? "" },
                                set: { form.setCustom($0, at: index, in: request) }
                            ), axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(1...5)
                            .accessibilityIdentifier("question-custom-\(index)")
                            if (form.custom[index]?.utf16.count ?? 0) > 2_000 {
                                Text("Keep this answer under 2,000 characters.").font(.caption).foregroundStyle(.red)
                            }
                        }
                    }
                    .disabled(answering || sent)
                }
                Button(sent ? "Answer sent" : "Send answers") {
                    answering = true
                    Task {
                        let accepted = await session.answerQuestions(chat: chat, card: card, form: form)
                        answering = false
                        if accepted { sent = true }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(answering || sent || form.answer(in: request) == nil)
                .accessibilityIdentifier("question-submit")
            } else {
                Text("This question format is not supported. Open it on your computer.").foregroundStyle(.secondary)
            }
        }
        .onChange(of: session.connection?.id) { _ in reset() }
        .onChange(of: card.requestId) { _ in reset() }
        .onChange(of: request) { _ in reset() }
    }

    private func reset() { form = QuestionAnswerForm(); answering = false; sent = false }
}
