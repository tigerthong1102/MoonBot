// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { voiceComposer } from "../cloudflare/control-plane/inbox/public/inbox-voice.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps the microphone open when an advertised encoder fails and ignores its late events", async () => {
  const recorders = [];
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream, { mimeType }) {
      this.stream = stream;
      this.mimeType = mimeType;
      this.state = "inactive";
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable({ data: new Blob(["audio"]) });
      this.onstop();
    }
  }
  const track = { readyState: "live", stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", Recorder);
  const recordButton = document.createElement("button");
  const stage = vi.fn(), error = vi.fn();
  const voice = voiceComposer({
    recordButton, dictateButton: document.createElement("button"), cancelButton: document.createElement("button"),
    status: document.createElement("span"), draft: document.createElement("textarea"), desktop: false,
    eligible: () => true, maxBytes: () => 1024, stage, changed: () => {}, error, t: key => key,
  });
  try {
    recordButton.click();
    await vi.waitFor(() => expect(recorders).toHaveLength(1));
    const [aac] = recorders;
    expect(aac.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
    aac.onerror({ error: { name: "EncodingError" } });
    aac.ondataavailable({ data: new Blob(["failed recording"]) });
    aac.onstop();
    expect(recorders.map(r => r.mimeType)).toEqual(["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus"]);
    expect(recorders[1].stream).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    recordButton.click();
    expect(stage).toHaveBeenCalledOnce();
    const [[file]] = stage.mock.calls;
    expect([file.name, file.type, file.size]).toEqual(["startupbot-voice.webm", "audio/webm;codecs=opus", 5]);
    expect(error).not.toHaveBeenCalled();
  } finally {
    voice.discard();
  }
});
