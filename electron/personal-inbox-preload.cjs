const { contextBridge, ipcRenderer } = require("electron");

const origin = process.argv.find(arg => arg.startsWith("--startupbot-inbox-origin="))?.slice("--startupbot-inbox-origin=".length);
if (process.isMainFrame && origin && location.origin === origin) {
  contextBridge.exposeInMainWorld("startupbotInboxVoice", {
    requestMicrophone: () => navigator.userActivation.isActive &&
      ipcRenderer.invoke("personal-inbox:request-microphone"),
    dictate: (action, id) => {
      if (action === "start" && !navigator.userActivation.isActive) return Promise.resolve(false);
      return ipcRenderer.invoke("personal-inbox:dictate", action, id);
    },
    onDictation: (listener) => {
      const receive = (_event, message) => listener(message);
      ipcRenderer.on("personal-inbox:dictation", receive);
      return () => ipcRenderer.removeListener("personal-inbox:dictation", receive);
    },
  });
}
