/**
 * Live verification for the wb_entity_modify rotate fix (2026-08-16): rotate must
 * write the single "angles" vector property, and the live transform must reflect it.
 *
 * Run with Workbench up + a world open in edit mode, AFTER a Workbench restart has
 * recompiled the WorkbenchGame handler scripts:
 *   npx tsx scripts/verify-rotate-fix.ts
 *
 * Uses a frame-aware reader so it also works while Workbench is mid-operation and
 * not closing sockets promptly (seen during a 7-minute "Reload Game Scripts" run).
 */
import { Socket } from "node:net";
import { encodeRequest, decodePascalString } from "../src/workbench/protocol.js";

function call(
  apiFunc: string,
  params: Record<string, unknown> = {},
  timeoutMs = 20000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sock = new Socket();
    const finish = (fn: () => void) => {
      sock.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${apiFunc} timed out (${Buffer.concat(chunks).length} bytes so far)`))),
      timeoutMs,
    );
    const tryDecode = () => {
      const buf = Buffer.concat(chunks);
      try {
        const { value: status, bytesRead } = decodePascalString(buf, 0);
        if (status !== "Ok") {
          clearTimeout(timer);
          finish(() => reject(new Error(`Workbench error: ${status}`)));
          return;
        }
        const { value: payload } = decodePascalString(buf, bytesRead);
        clearTimeout(timer);
        finish(() => resolve(JSON.parse(payload)));
      } catch {
        /* incomplete frame — keep reading */
      }
    };
    sock.on("data", (d) => {
      chunks.push(d);
      tryDecode();
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      finish(() => reject(e));
    });
    sock.connect(5775, "127.0.0.1", () => sock.write(encodeRequest("EnfusionMCP", apiFunc, params)));
  });
}

function log(label: string, v: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(v, null, 2));
}

const state = await call("EMCP_WB_GetState");
log("GetState", { status: state.status, mode: state.mode, entityCount: state.entityCount });
if (state.mode !== "edit") {
  console.log(`ABORT: mode='${state.mode}', need edit mode.`);
  process.exit(2);
}

const name = "EMCP_RotateTest_1";
try {
  await call("EMCP_WB_DeleteEntity", { name });
  console.log("(cleaned up leftover test entity)");
} catch {
  /* none existed */
}

const created = await call("EMCP_WB_CreateEntity", {
  prefab: "GenericEntity",
  name,
  position: "100 10 100",
  rotation: "0 0 0",
});
log("Create", created);

const rotated = await call("EMCP_WB_ModifyEntity", { name, action: "rotate", value: "0 90 0" });
log("Rotate to 0 90 0", rotated);

const inspected = await call("EMCP_WB_GetEntity", { name });
log("Inspect (live transform)", {
  position: inspected.position,
  rotation: inspected.rotation,
});

const gwt = await call("EMCP_WB_ModifyEntity", { name, action: "getWorldTransform" });
log("getWorldTransform (source)", gwt.properties);

const deleted = await call("EMCP_WB_DeleteEntity", { name });
log("Delete (cleanup)", { status: deleted.status, message: deleted.message });

const rot = String(inspected.rotation ?? "");
console.log(`\n>>> Live entity rotation after rotate: '${rot}'`);
if (rot.split(" ")[1]?.startsWith("90")) {
  console.log(">>> PASS: live transform reflects the rotation.");
} else {
  console.log(">>> FAIL: live transform did not update.");
  process.exitCode = 1;
}
