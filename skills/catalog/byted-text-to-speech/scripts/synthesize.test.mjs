import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { synthesize } from './synthesize.mjs';

test('sends an authorized request and writes streamed audio once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'startupbot-tts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'voice.mp3');
  const transport = async (url, options) => {
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Api-Key'], 'fixture-key');
    const body = JSON.parse(options.body);
    assert.equal(body.req_params.text, 'Xin chào');
    assert.equal(body.req_params.speaker, 'fixture-voice');
    assert.equal(body.req_params.audio_params.sample_rate, 16000);
    assert.equal(body.req_params.sample_rate, undefined);
    const additions = JSON.parse(body.req_params.additions);
    assert.equal(additions.disable_markdown_filter, true);
    assert.equal(additions.enable_latex_tn, true);
    return new Response('data: {"code":0,"data":"YWJj"}\n\ndata: {"code":20000000,"data":"ZGVm"}\n');
  };
  const result = await synthesize({ text: 'Xin chào', output, apiKey: 'fixture-key', speaker: 'fixture-voice', sampleRate: 16000, enableLatex: true, filterMarkdown: true, transport });
  assert.equal(result.status, 'success');
  assert.equal((await readFile(output)).toString(), 'abcdef');
  await assert.rejects(synthesize({ text: 'Xin chào', output, apiKey: 'fixture-key', transport }), /Output already exists/);
  assert.equal((await readFile(output)).toString(), 'abcdef');
});

test('maps Markdown and LaTeX flags independently', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'startupbot-tts-flags-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [filterMarkdown, enableLatex] of [[false, false], [true, false], [false, true], [true, true]]) {
    const output = join(dir, `${filterMarkdown}-${enableLatex}.mp3`);
    const transport = async (_url, options) => {
      const additions = JSON.parse(JSON.parse(options.body).req_params.additions);
      assert.equal(additions.disable_markdown_filter, filterMarkdown || enableLatex);
      assert.equal(additions.enable_latex_tn, enableLatex);
      return new Response('data: {"code":0,"data":"YQ=="}\n\ndata: {"code":20000000}\n');
    };
    await synthesize({ text: 'test', output, apiKey: 'fixture-key', filterMarkdown, enableLatex, transport });
  }
});

test('rejects missing credentials, provider errors and invalid audio without replacing a file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'startupbot-tts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'voice.mp3');
  let called = false;
  const transport = async () => { called = true; return new Response('data: {"code":100,"message":"sensitive"}\n'); };
  await assert.rejects(synthesize({ text: 'test', output, transport }), /MODEL_SPEECH_API_KEY/);
  await assert.rejects(synthesize({ text: 'test', output, apiKey: 'fixture-key', timeoutSeconds: 0, transport }), /Timeout/);
  assert.equal(called, false);
  await assert.rejects(synthesize({ text: 'test', output, apiKey: 'fixture-key', transport }), /code 100/);
  await assert.rejects(synthesize({ text: 'test', output, apiKey: 'fixture-key', transport: async () => new Response('data: {"code":0,"data":"!!!!"}\n') }), /Invalid audio encoding/);
  await assert.rejects(synthesize({ text: 'test', output, apiKey: 'fixture-key', transport: async () => new Response('data: {"code":0,"data":"YWJj"}\n') }), /response was incomplete/);
  await assert.rejects(readFile(output), /ENOENT/);
  await writeFile(output, 'keep');
  await assert.rejects(synthesize({ text: 'test', output, apiKey: 'fixture-key', transport }), /Output already exists/);
  assert.equal((await readFile(output)).toString(), 'keep');
});

test('CLI reads a private text file and receives credentials through the environment', async t => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'startupbot-tts-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'text.txt'), output = join(dir, 'audio.mp3'), preload = join(dir, 'fake-provider.mjs');
  await writeFile(input, 'Nội dung riêng');
  await writeFile(preload, `globalThis.fetch = async (_url, options) => { if (options.headers['X-Api-Key'] !== 'fixture-key') throw Error('missing key'); return new Response('data: {"code":0,"data":"YXVkaW8="}\\n\\ndata: {"code":20000000}\\n'); };`);
  const script = fileURLToPath(new URL('./synthesize.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', preload, script, '--text-file', input, '--output', output], { encoding: 'utf8', env: { PATH: process.env.PATH, MODEL_SPEECH_API_KEY: 'fixture-key' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await readFile(output)).toString(), 'audio');
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-key|Nội dung riêng/);
});
