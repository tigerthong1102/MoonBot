import { writeFile } from "node:fs/promises";
import { simulatorCapture } from "../electron/local-simulator.mjs";
const [id, out] = process.argv.slice(2);
const capture = await simulatorCapture(id);
await writeFile(out, Buffer.from(capture.png,"base64"));
console.log("Captured " + capture.device.name + " " + capture.device.runtime + " " + capture.device.udid);
