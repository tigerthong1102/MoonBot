import Foundation

public struct AskQuestionOption: Codable, Hashable, Sendable {
    public var label: String
    public var description: String?
}

public struct AskQuestion: Codable, Hashable, Sendable {
    public var question: String
    public var header: String?
    public var multiSelect: Bool?
    public var options: [AskQuestionOption]
    public var custom: Bool?

    public var allowsCustom: Bool { options.isEmpty || custom != false }

    private enum CodingKeys: String, CodingKey { case question, header, multiSelect, options, custom }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        question = try values.decode(String.self, forKey: .question)
        header = try values.decodeIfPresent(String.self, forKey: .header)
        multiSelect = try values.decodeIfPresent(Bool.self, forKey: .multiSelect)
        options = try values.decodeIfPresent([AskQuestionOption].self, forKey: .options) ?? []
        custom = try values.decodeIfPresent(Bool.self, forKey: .custom)
    }
}

public struct QuestionRequestCardData: Codable, Hashable, Sendable {
    public var version: Int
    public var questions: [AskQuestion]
    public var origin: String?

    public var isSupported: Bool {
        version == 1 && (1...6).contains(questions.count) && questions.allSatisfy { question in
            !question.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            question.question.utf16.count <= 8_000 && question.options.count <= 12 &&
            (question.header?.utf16.count ?? 0) <= 120 &&
            Set(question.options.map(\.label)).count == question.options.count &&
            question.options.allSatisfy {
                !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                $0.label.utf16.count <= 120 && ($0.description?.utf16.count ?? 0) <= 400
            }
        }
    }
}

public struct QuestionAnswerForm: Sendable {
    public private(set) var selected: [Int: Set<String>] = [:]
    public private(set) var custom: [Int: String] = [:]

    public init() {}

    public mutating func choose(_ label: String, at index: Int, in request: QuestionRequestCardData) {
        guard request.isSupported, request.questions.indices.contains(index) else { return }
        let question = request.questions[index]
        guard question.options.contains(where: { $0.label == label }) else { return }
        if question.multiSelect == true {
            var values = selected[index] ?? []
            if !values.insert(label).inserted { values.remove(label) }
            selected[index] = values
        } else {
            selected[index] = [label]
            custom[index] = nil
        }
    }

    public mutating func setCustom(_ value: String, at index: Int, in request: QuestionRequestCardData) {
        guard request.isSupported, request.questions.indices.contains(index), request.questions[index].allowsCustom else { return }
        custom[index] = value
        if request.questions[index].multiSelect != true, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            selected[index] = []
        }
    }

    public func answer(in request: QuestionRequestCardData) -> String? {
        guard request.isSupported else { return nil }
        var answers: [[String]] = []
        for (index, question) in request.questions.enumerated() {
            var values = question.options.filter { selected[index]?.contains($0.label) == true }.map(\.label)
            let text = (custom[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.utf16.count <= 2_000 else { return nil }
            if question.allowsCustom, !text.isEmpty { values.append(text) }
            guard !values.isEmpty, question.multiSelect == true || values.count == 1 else { return nil }
            answers.append(values)
        }
        return Self.format(questions: request.questions, answers: answers)
    }

    public static func format(questions: [AskQuestion], answers: [[String]]) -> String {
        let pairs: [[String]] = questions.enumerated().compactMap { index, question in
            let values = (answers.indices.contains(index) ? answers[index] : [])
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            return values.isEmpty ? nil : [question.question, values.joined(separator: ", ")]
        }
        guard !pairs.isEmpty else { return "" }
        let preamble = "The user answered your questions.\n\n"
        if pairs.joined().contains(where: { $0.contains("\n") || $0.contains("\r") }) {
            guard let data = try? JSONSerialization.data(withJSONObject: pairs, options: [.withoutEscapingSlashes]),
                  let json = String(data: data, encoding: .utf8) else { return "" }
            return preamble + "Answers (JSON):\n" + json
        }
        return preamble + pairs.map { "Q: \($0[0])\nA: \($0[1])" }.joined(separator: "\n\n")
    }

    public static func display(_ answer: String) -> String {
        let preamble = "The user answered your questions.\n\n"
        guard answer.hasPrefix(preamble) else { return answer }
        let content = String(answer.dropFirst(preamble.count))
        let marker = "Answers (JSON):\n"
        guard content.hasPrefix(marker),
              let data = String(content.dropFirst(marker.count)).data(using: .utf8),
              let pairs = try? JSONDecoder().decode([[String]].self, from: data),
              pairs.allSatisfy({ $0.count == 2 }) else { return content }
        return pairs.map { "\($0[0])\n\($0[1])" }.joined(separator: "\n\n")
    }
}
