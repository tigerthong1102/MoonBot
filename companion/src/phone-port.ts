import { createServer } from "node:net";

function availableOnLoopback(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve(true)));
  });
}

export async function listenOnPhonePort(ports: number[], listen: (port: number) => Promise<void>): Promise<number> {
  for (const port of ports) {
    if (!await availableOnLoopback(port)) continue;
    try {
      await listen(port);
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No available StartupBot phone port");
}
