import { createServer } from "node:net";

export const phonePorts = [8810, 18810];

function available(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", error => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    probe.listen(port, host, () => probe.close(error => error ? reject(error) : resolve(true)));
  });
}

export async function choosePhonePort(preferred, ports = phonePorts) {
  const candidates = ports.includes(preferred) ? [preferred, ...ports.filter(port => port !== preferred)] : ports;
  for (const port of candidates) {
    if (await available(port, "127.0.0.1") && await available(port, "0.0.0.0")) return port;
  }
  throw new Error("No available StartupBot phone port");
}
