import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useComposerDictation } from "@/lib/use-composer-dictation";

type Bridge = NonNullable<NonNullable<Window["ogb"]>["inboxDictation"]>;

function Session({ bridge, id, finish, clear }: { bridge: Bridge; id: string; finish: boolean; clear(id: string): void }) {
  const [transcript, setTranscript] = useState("");
  const report = useCallback((result: Parameters<Bridge["report"]>[1]) => {
    void bridge.report(id, result).catch(() => {});
    if ("status" in result) clear(id);
  }, [bridge, clear, id]);
  const update = useCallback((text: string) => {
    setTranscript(text);
    report({ text });
  }, [report]);
  const { recording, ready, speechError, toggle } = useComposerDictation({ draftId: id, text: transcript, onText: update });
  const heard = useRef(false);
  const start = useEffectEvent(() => {
    if (ready) toggle();
    else report({ status: "unavailable" });
  });
  const finishCapture = useEffectEvent(toggle);
  useEffect(() => { start(); }, []);
  useEffect(() => { if (finish && recording) finishCapture(); }, [finish, recording]);
  useEffect(() => {
    if (recording) heard.current = true;
    else if (heard.current || speechError) report({ status: speechError ? "failed" : "done" });
  }, [recording, speechError, report]);
  return null;
}

export function InboxDictation() {
  const bridge = window.ogb?.inboxDictation;
  const [request, setRequest] = useState<{ id: string; finish: boolean } | null>(null);
  useEffect(() => bridge?.subscribe(({ id, action }) => {
    setRequest(current => {
      if (action === "start") return { id, finish: false };
      if (current?.id !== id) return current;
      return action === "finish" ? { id, finish: true } : null;
    });
  }), [bridge]);
  const clear = useCallback((id: string) => {
    setRequest(current => current?.id === id ? null : current);
  }, []);
  return bridge && request ? <Session key={request.id} bridge={bridge} clear={clear} {...request} /> : null;
}
