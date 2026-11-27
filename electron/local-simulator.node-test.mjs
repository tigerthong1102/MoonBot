import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, access } from "node:fs/promises";
import { bootedSimulators, simulatorCapture } from "./local-simulator.mjs";
const udid = "D1E1AFDA-007D-49F0-9A06-BB7EF09CC45E";
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-0";
const phone = { udid, name:"Test iPhone", state:"Booted", isAvailable:true };
const list = JSON.stringify({devices:{[runtime]:[phone,{...phone,state:"Shutdown"},{...phone,isAvailable:false}],"com.apple.CoreSimulator.SimRuntime.tvOS-26-0":[phone]}});
test("captures only the chosen booted iOS device and removes the temporary PNG", async () => {
  let path;
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const invoke = async args => {
    if (args[1] === "list") return list;
    assert.deepEqual(args.slice(0,4),["simctl","io",udid,"screenshot"]);
    path = args[4];
    await writeFile(path,png);
    return "";
  };
  assert.deepEqual(await bootedSimulators(invoke), [{udid,name:phone.name,runtime}]);
  assert.equal((await simulatorCapture(udid,invoke)).png,png.toString("base64"));
  await assert.rejects(access(path));
  await assert.rejects(simulatorCapture("--booted",invoke),/Choose/);
  await assert.rejects(simulatorCapture(udid,async()=>"{\"devices\":{}}"),/no longer booted/);
});
