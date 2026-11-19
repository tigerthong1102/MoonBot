import AppKit
import Vision
let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["vi-VN","en-US"]
try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
let text = lines.joined(separator: " ").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "vi_VN"))
guard text.contains("startupbot") && (text.contains("chao mung") || text.contains("ket noi")) else { exit(1) }
