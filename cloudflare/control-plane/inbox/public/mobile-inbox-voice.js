export function connectMobileVoice(receive, available) {
  const platform = new URLSearchParams(location.search).get("mobile");
  function bind(send) {
    return {
      requestMicrophone: () => navigator.userActivation.isActive,
      async dictate(action, id) {
        if (action === "start" && !navigator.userActivation.isActive) return false;
        send({ action, id });
        return true;
      },
    };
  }
  if (platform === "ios" && window.webkit?.messageHandlers?.startupbotVoice) {
    window.addEventListener("startupbot-mobile-dictation", event => receive(event.detail));
    return bind(message => window.webkit.messageHandlers.startupbotVoice.postMessage(message));
  }
  if (platform !== "android") return null;
  window.addEventListener("message", function connect(event) {
    const port = event.ports[0];
    if (event.data !== "startupbot-mobile-voice" || !port) return;
    window.removeEventListener("message", connect);
    port.onmessage = response => {
      try { receive(JSON.parse(response.data)); } catch {}
    };
    available(bind(message => port.postMessage(JSON.stringify(message))));
  });
  return null;
}
