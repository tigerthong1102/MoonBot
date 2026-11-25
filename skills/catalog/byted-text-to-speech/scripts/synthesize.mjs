// Copyright (c) 2025 Beijing Volcano Engine Technology Co., Ltd. and/or its affiliates.
// Adapted for StartupBot under the Apache License, Version 2.0; see ../LICENSE and ../SOURCE.md.
import { readFile, open, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const endpoint = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const formats = ['mp3', 'pcm', 'ogg_opus'];
const sampleRates = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
const maxResponseBytes = 100 * 1024 * 1024;

export async function synthesize({ text, output, apiKey, resourceId = 'seed-tts-2.0', speaker = 'zh_female_vv_uranus_bigtts', format = 'mp3', sampleRate = 24000, speechRate = 0, pitchRate = 0, loudnessRate = 0, bitRate = 64000, enableLatex = false, filterMarkdown = false, timeoutSeconds = 60, transport = fetch }) {
  if (!apiKey?.trim()) throw new Error('MODEL_SPEECH_API_KEY is required.');
  if (!text?.trim() || !output) throw new Error('Text and a new output path are required.');
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Text exceeds the 1 MiB limit.');
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) throw new Error('Timeout must be between 1 and 600 seconds.');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(resourceId)) throw new Error('Invalid resource ID.');
  if (!formats.includes(format) || !sampleRates.includes(sampleRate)) throw new Error('Unsupported format or sample rate.');
  if (![speechRate, pitchRate, loudnessRate, bitRate].every(Number.isInteger) || speechRate < -50 || speechRate > 100 || pitchRate < -12 || pitchRate > 12 || loudnessRate < -50 || loudnessRate > 100 || bitRate <= 0) throw new Error('Invalid audio settings.');
  try { await lstat(output); throw new Error('Output already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const audioParams = { format, speech_rate: speechRate, loudness_rate: loudnessRate };
  if (format !== 'pcm') audioParams.bit_rate = bitRate;
  const response = await transport(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutSeconds * 1000),
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey.trim(), 'X-Api-Resource-Id': resourceId, 'X-Api-Request-Id': randomUUID() },
    body: JSON.stringify({ user: { uid: 'skill_tts_user' }, req_params: { text: text.trim(), speaker, sample_rate: sampleRate, audio_params: audioParams, additions: JSON.stringify({ post_process: { pitch: pitchRate }, disable_markdown_filter: !filterMarkdown, enable_latex_tn: enableLatex, latex_parser: 'v2' }) } }),
  });
  if (!response.ok || !response.body) throw new Error(`ByteDance request failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', received = 0;
  const chunks = [];
  const consume = line => {
    if (!line.startsWith('data:')) return;
    let event;
    try { event = JSON.parse(line.slice(5).trim()); } catch { throw new Error('Invalid speech response.'); }
    if (event.code != null && ![0, 20000000].includes(event.code)) throw new Error(`ByteDance speech failed (code ${String(event.code).replace(/[^0-9-]/g, '')}).`);
    if (event.data) {
      if (typeof event.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data)) throw new Error('Invalid audio encoding.');
      chunks.push(Buffer.from(event.data, 'base64'));
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxResponseBytes) throw new Error('Speech response exceeds the size limit.');
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    if (pending) consume(pending);
  } finally { await reader.cancel().catch(() => {}); }
  if (!chunks.length || !chunks.some(chunk => chunk.length)) throw new Error('ByteDance returned no audio.');
  const handle = await open(output, 'wx', 0o600);
  try { for (const chunk of chunks) await handle.writeFile(chunk); } finally { await handle.close(); }
  return { status: 'success', local_path: output, format };
}

async function main() {
  const { values } = parseArgs({ options: { 'text-file': { type: 'string' }, output: { type: 'string' }, speaker: { type: 'string' }, format: { type: 'string' }, 'sample-rate': { type: 'string' }, 'speech-rate': { type: 'string' }, 'pitch-rate': { type: 'string' }, 'loudness-rate': { type: 'string' }, 'bit-rate': { type: 'string' }, 'enable-latex': { type: 'boolean' }, 'filter-markdown': { type: 'boolean' }, timeout: { type: 'string' } } });
  if (!values['text-file'] || !values.output) throw new Error('Use --text-file INPUT --output NEW_FILE.');
  const text = await readFile(values['text-file'], 'utf8');
  const number = (key, fallback) => values[key] === undefined ? fallback : Number(values[key]);
  const result = await synthesize({ text, output: values.output, apiKey: process.env.MODEL_SPEECH_API_KEY, resourceId: process.env.MODEL_SPEECH_TTS_RESOURCE_ID || 'seed-tts-2.0', speaker: values.speaker, format: values.format, sampleRate: number('sample-rate', 24000), speechRate: number('speech-rate', 0), pitchRate: number('pitch-rate', 0), loudnessRate: number('loudness-rate', 0), bitRate: number('bit-rate', 64000), enableLatex: values['enable-latex'], filterMarkdown: values['filter-markdown'], timeoutSeconds: number('timeout', 60) });
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const known = ['MODEL_SPEECH_API_KEY is required.', 'Text and a new output path are required.', 'Text exceeds the 1 MiB limit.', 'Unsupported format or sample rate.', 'Invalid resource ID.', 'Timeout must be between 1 and 600 seconds.', 'Invalid audio settings.', 'Output already exists.', 'Invalid speech response.', 'Invalid audio encoding.', 'ByteDance returned no audio.', 'Speech response exceeds the size limit.', 'Use --text-file INPUT --output NEW_FILE.'];
  const message = known.includes(error.message) || /^ByteDance (request failed \(HTTP \d+\)|speech failed \(code -?\d+\))\.$/.test(error.message) ? error.message : 'Speech synthesis failed. Check the input, output path, service access and network.';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
