import init, { compress } from "./brotli-3.0.1/brotli_wasm.js";
const ready = init();
self.onmessage = async ({ data: { id, blob } }) => {
  try {
    await ready;
    const bytes = compress(new Uint8Array(await blob.arrayBuffer()), { quality: 5 });
    self.postMessage({ id, bytes }, [bytes.buffer]);
  } catch {
    self.postMessage({ id });
  }
};
