// Adapted from stablyai/orca src/shared/source-control/ai/generation/commit-message-model-parsers.ts.
// MIT, Copyright (c) 2026 Lovecast Inc. See public/licenses/orca.txt.
interface CursorModel { id: string; label: string; isDefault?: boolean }

function uniqueModels(models: CursorModel[]): CursorModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) {
      return false
    }
    seen.add(model.id)
    return true
  })
}

function* iterateModelOutputLines(output: string): Generator<string> {
  let lineStart = 0

  for (let index = 0; index < output.length; index++) {
    const code = output.charCodeAt(index)
    if (code !== 10 && code !== 13) {
      continue
    }

    yield output.slice(lineStart, index)
    if (code === 13 && output.charCodeAt(index + 1) === 10) {
      index++
    }
    lineStart = index + 1
  }

  if (lineStart <= output.length) {
    yield output.slice(lineStart)
  }
}

export function parseCursorModels(stdout: string): CursorModel[] {
  const models: CursorModel[] = []
  for (const rawLine of iterateModelOutputLines(stdout)) {
    // Rows read `id - Name`, or a bare `id` when the model has no name, optionally ending in
    // `(current)`, `(default)` or `(current, default)`.
    const match =
      /^(\S+)(?:\s+-\s+(.+?))?(?:\s+\(((?:current|default)(?:,\s*(?:current|default))?)\))?$/i.exec(
        rawLine.trim()
      )
    if (!match || (!match[2] && !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(match[1]!))) {
      continue
    }
    models.push({
      id: match[1]!,
      label: match[2] ?? match[1]!,
      ...(/default/i.test(match[3] ?? '') ? { isDefault: true } : {})
    })
  }
  return uniqueModels(models)
}
