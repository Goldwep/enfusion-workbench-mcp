/**
 * Live-safety audit (PLAN section 11 criterion 8; plan sections 5.1, 5.3, 5.4, 5.7; DEC-058,
 * DEC-100).
 *
 * Criterion 8: "Client queue, lease, modal watchdog, build stamp, opened-project assertion,
 * deny-list from verified labels, RunCommandline ban and sandbox-only tests are all in place,
 * each with a negative test." This script holds one row per safety mechanism: where it is
 * implemented (a file and a marker string the file must contain), its positive tests and its
 * NEGATIVE tests (the test that proves it refuses). Every reference is checked against the tree:
 * the file must exist and must contain the test name as a quoted string literal.
 *
 * It also checks the "from verified labels" half of the deny-list item against the census: every
 * label on a policy deny list must name at least one ui ledger row that a live census enumerator
 * (L01 to L16) observed. A label only the static enumerators know is reported as unverified.
 *
 * Usage:  npx tsx scripts/audit/live-safety.ts [--md] [--no-ledger]
 *   --md         print the table as Markdown (the inbox note's table)
 *   --no-ledger  skip the deny-label check against data/census/ledger.jsonl
 * Exit: 0 every mechanism paired and every reference found; 1 a mechanism with no negative test
 * or a reference that does not resolve; 2 usage. Unverified deny labels are reported, and fail
 * the run only with --strict-labels.
 *
 * Read-only: it reads files under the repository and writes nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** "exec": the test runs the mechanism (under a fake) and sees it refuse; "static": a source scan. */
export type TestKind = "exec" | "static";

export interface TestRef {
  file: string;
  name: string;
  kind?: TestKind;
}

export interface ImplRef {
  file: string;
  marker: string;
}

export interface Mechanism {
  id: string;
  name: string;
  /** Where the plan asks for it: "C8" marks the eight items criterion 8 names. */
  source: string;
  impl: ImplRef[];
  positive: TestRef[];
  negative: TestRef[];
  note?: string;
}

const T = (file: string, name: string, kind: TestKind = "exec"): TestRef => ({ file, name, kind });
const I = (file: string, marker: string): ImplRef => ({ file, marker });

const CG = "tests/workbench/client-guards.test.ts";
const KT = "tests/workbench/kernel.test.ts";
const PF = "tests/live-harness/preflight.test.ts";
const PO = "tests/live-harness/postflight.test.ts";
const DR = "tests/live-harness/dry-run.test.ts";
const DK = "tests/live-harness/dry-run-kinds.test.ts";
const PP = "tests/live-harness/probe-pack.test.ts";
const SG = "tests/live-harness/shipped-guard.test.ts";
const NG = "tests/audit/negative/battery-gate.test.ts";
const NR = "tests/audit/negative/runcommandline-ban.test.ts";

export const MECHANISMS: Mechanism[] = [
  {
    id: "client-queue",
    name: "Client queue (one call at a time, wedge detector, no retry of a mutating call)",
    source: "C8; plan 5.3 'One call at a time'; U30, DEC-042",
    impl: [I("src/workbench/client.ts", "class CallQueue")],
    positive: [
      T(KT, "serialises concurrent calls: the server never sees two at once"),
      T(KT, "runs normal jobs one at a time and a probe beside the job in flight"),
    ],
    negative: [
      T(KT, "past the wedge threshold waiting and new jobs fail WEDGED; it clears when the job settles"),
      T(KT, "a mutating reset is LOST at any age"),
      T(KT, "A-1: a timed-out mutating call is LOST, a read-only one TIMEOUT"),
    ],
  },
  {
    id: "lease",
    name: "Machine-wide lease (a held or orphaned lease refuses launch, install and every live call)",
    source: "C8; plan 5.1 guard 1, 5.3 pre-flight step 1",
    impl: [
      I("src/workbench/lease.ts", "export function leaseBlocker"),
      I("src/workbench/client.ts", "LEASE_HELD"),
      I("scripts/live/lane.ts", "class Lane"),
    ],
    positive: [
      T("tests/workbench/lease.test.ts", "creates the lease when free, including the parent directory"),
      T(CG, "acquires a free lease on the first call and proceeds"),
    ],
    negative: [
      T(CG, "refuses call() with LEASE_HELD before any traffic when another session holds the lease"),
      T(CG, "refuses call() for an orphaned lease without taking it"),
      T(CG, "refuses ensureRunning(explicit) under a held lease and installs nothing"),
      T("tests/workbench/lease.test.ts", "never takes an orphaned lease (expired heartbeat, pid still running)"),
      T("tests/workbench/spawned-guards.test.ts", "refuses wb_launch and wb_state while another session holds the lease"),
      T(PF, "stops at step 1 when another session holds the lease"),
      T("tests/live-harness/lane.test.ts", "refuses a lease held by another session with the plan's wording"),
    ],
  },
  {
    id: "no-autolaunch",
    name: "No-autolaunch marker and the refusal of auto-launch without an explicit project",
    source: "plan 5.1 guards 2 and 3",
    impl: [I("src/workbench/client.ts", "AUTOLAUNCH_REFUSED")],
    positive: [
      T(CG, "launches an explicit project even while the marker exists"),
      T(CG, "launches the defaultMod project and records it in our lease"),
    ],
    negative: [
      T(CG, "refuses with AUTOLAUNCH_REFUSED while the marker exists and writes no handler files"),
      T(CG, "refuses without defaultMod instead of picking the first addon found"),
      T(CG, "refuses when several loaded projects resolve to addons on disk"),
      T("tests/workbench/spawned-guards.test.ts", "refuses auto-launch without an explicit project when the marker is absent"),
    ],
  },
  {
    id: "modal-watchdog",
    name: "Modal watchdog (report and wait; never answers the authorization prompt)",
    source: "C8; plan 5.3 'On any timeout, do not retry'; DEC-042 U6, DEC-048 3.5",
    impl: [
      I("src/gui/modal-watchdog.ts", "AUTH_WINDOW_TITLE"),
      I("src/workbench/client.ts", "MODAL_OPEN"),
    ],
    positive: [
      T("tests/gui/modal-watchdog.test.ts", "takes a baseline, then reports a new dialog with its buttons and waits"),
      T(KT, "a read-only reset near 120 s is MODAL_OPEN, an early one a PROTOCOL_ERROR"),
    ],
    negative: [
      T("tests/gui/modal-watchdog.test.ts", "NEVER answers the authorization prompt, even with a rule naming it"),
      T("tests/gui/modal-watchdog.test.ts", "today's policy.json lists no watchdog answers: report and wait"),
      T("tests/live-harness/kernel-battery.test.ts", "k-08 stops when the window that opens is the authorization prompt, not the probe modal"),
    ],
  },
  {
    id: "dialog-handoff",
    name: "A dialog is a handoff (never answered by the lane; dialog openers never invoked)",
    source: "plan 5.3 'During' and post-flight step 2; DEC-100 dialog_openers",
    impl: [
      I("scripts/live/dry-run.ts", "dialog-opener-observed"),
      I("tests/live/w9.live.ts", "handoff"),
    ],
    positive: [
      T(DK, "a listed opener passes; an unlisted one, opensDialog false, or a deny-listed one does not"),
    ],
    negative: [
      T("tests/live-harness/w9-battery.test.ts", "a dialog (MODAL_OPEN) is a handoff that answers No on a save prompt, never Save"),
      T(PO, "a dialog stops the close: reported as a hazard, never answered, still running"),
      T(DK, "Window > Manage Layouts is refused dialog-opener-observed by every route, and no exception lifts it"),
      T("tests/tools/wb-menu.test.ts", "a trailing ellipsis (three dots or one character) opens a dialog"),
      T(DR, "fails a confirm invoke of a dialog on the never-invoked list"),
    ],
  },
  {
    id: "build-stamp",
    name: "Handler build stamp (Ping's buildStamp must equal the bundle digest before a battery runs)",
    source: "C8; plan 5.4 step 4; DEC-048 package A",
    impl: [
      I("src/workbench/client.ts", "export function checkBuildStamp"),
      I("scripts/build-stamp.ts", "digest"),
      I("tests/live/w10.live.ts", "the build stamp does not match the bundle digest"),
    ],
    positive: [
      T(KT, "compares Ping's buildStamp with the bundle"),
      T(KT, "digest leaves the stamp file out and changes with any handler"),
    ],
    negative: [
      T(NG, "a stale build stamp stops, and nothing but the read-only close-out is sent"),
      T(NG, "an absent stamp or an absent bundle digest stops as well"),
      T("tests/live-harness/rewalk-subeditors.test.ts", "stops when the build stamp is not the bundle digest"),
    ],
    note:
      "The shipped client only warns on a mismatch (checkBuildStamp returns status mismatch with a warning; calls go on). The stop lives in the live lane's battery gates.",
  },
  {
    id: "opened-project",
    name: "Opened-project assertion (pre-flight step 9 against the session log)",
    source: "C8; plan 5.3 pre-flight step 9",
    impl: [I("scripts/live/preflight.ts", "export function openedProjectFromLog")],
    positive: [
      T(PF, "polls until a log born after the spawn names the project, with E13's pattern by default"),
    ],
    negative: [
      T(PF, "fails at once on another project, and at the deadline when no line appears"),
      T(PF, "never reads a log folder born before the spawn"),
    ],
  },
  {
    id: "single-instance",
    name: "No second Workbench (a GUI launch never spawns beside a running one)",
    source: "total audit live-client-02; cli-runner.ts headlessSpawnBlocker for the headless side",
    impl: [
      I("src/workbench/client.ts", "async pingStatus"),
      I("src/workbench/client.ts", "this.workbenchPids()"),
      I("src/tools/wb-launch.ts", "client.pingStatus()"),
    ],
    positive: [
      T("tests/tools/wb-launch.test.ts", "live-client-02: a Workbench without handlers gets them in its open project, no second launch"),
    ],
    negative: [
      T("tests/workbench/client-spawn-guard.test.ts", "refuses to spawn while a Workbench process runs behind a refused port"),
      T("tests/workbench/client-spawn-guard.test.ts", "refuses to spawn while a Workbench answers without the handlers"),
      T("tests/workbench/client-spawn-guard.test.ts", "refuses to spawn while a Workbench gives an unusable Ping answer"),
      T("tests/tools/wb-launch.test.ts", "live-client-02: a Workbench giving an unusable Ping answer is refused, not launched beside"),
    ],
  },
  {
    id: "launch-project-match",
    name: "wb_launch into a running Workbench only for the project it has loaded",
    source: "total audit live-client-04",
    impl: [I("src/workbench/client.ts", "async assertProjectLoaded")],
    positive: [
      T("tests/tools/wb-launch.test.ts", "answers Already Running and adopts the addon when the gprojPath is the open project"),
    ],
    negative: [
      T("tests/tools/wb-launch.test.ts", "live-client-04: refuses a gprojPath the running Workbench does not have open"),
      T("tests/tools/wb-launch.test.ts", "live-client-02: a Workbench without handlers and another project open is refused"),
      T("tests/tools/wb-launch.test.ts", "does not auto-open the default mod's world in a Workbench running another project"),
    ],
  },
  {
    id: "standalone-cleanup",
    name: "Standalone-addon cleanup deletes only the generated 1.x addon, never the project in use",
    source: "total audit live-client-01",
    impl: [
      I("src/workbench/client.ts", "export function isOurStandaloneAddon"),
      I("src/workbench/client.ts", "pathsOverlap(standaloneDir, protectedDir)"),
    ],
    positive: [T(CG, "still removes the generated 1.x addon beside another project")],
    negative: [
      T(CG, "launching a user project at <projectPath>/EnfusionMCP never deletes it"),
      T(CG, "live-client-01: recovery into a user project named EnfusionMCP keeps that project"),
      T(CG, "keeps a user EnfusionMCP addon that holds handlers while another project launches"),
      T(CG, "keeps even the generated addon when it is the project being launched"),
      T(CG, "keeps the generated addon once a user file was added to it"),
    ],
  },
  {
    id: "cli-plugin-paths",
    name: "wb_cli_run plugin path rules (reads stay in the project, writes under the artifacts folder)",
    source: "total audit live-client-03; DEC-069 OD-13",
    impl: [I("src/tools/wb-cli-run.ts", "export const PLUGIN_PATH_RULES")],
    positive: [
      T("tests/tools/wb-cli-run.test.ts", "checkPluginPaths matches keys case-insensitively and is null for a plugin without rules"),
    ],
    negative: [
      T("tests/tools/wb-cli-run.test.ts", "live-client-03: AddonBuildInfoTool reads only the project and writes only a .json under the artifacts folder"),
    ],
  },
  {
    id: "test-bed-gate",
    name: "Test-bed gate of the batteries (Info names EMCP2_sandbox, stamp, plant)",
    source: "plan 5.3 step 9 inside each battery; DEC-058 (the check lives in the battery, not in a shipped handler)",
    impl: [I("tests/live/w9.live.ts", "not the live lane's test bed")],
    positive: [
      T("tests/live-harness/w2-battery.test.ts", "the gate passes on the test bed and takes the battery snapshot"),
    ],
    negative: [
      T(NG, "a project other than the test bed aborts, and nothing is sent"),
      T(NG, "no project found (Info null or projectFound 0) aborts, and nothing is sent"),
      T("tests/live-harness/kernel-battery.test.ts", "aborts when Info names a project other than the test bed"),
      T("tests/live-harness/w1-battery.test.ts", "refuses to start unless the open project is the test bed"),
      T("tests/live-harness/w8-battery.test.ts", "the gate aborts on a project that is not the test bed"),
      T("tests/live-harness/w9-battery.test.ts", "the gate aborts off the test bed and stops without -forceSettings"),
      T("tests/live-harness/w2-battery.test.ts", "the test-bed check lives in the battery, never in a shipped handler or tool", "static"),
    ],
  },
  {
    id: "sandbox-only",
    name: "Sandbox-only live tests (launch, plant and override only on the 2.0 sandbox)",
    source: "C8; plan 5.1 'The registered MCP server' and 'The sandbox'",
    impl: [I("scripts/live/dry-run.ts", "launch-not-sandbox")],
    positive: [T(DR, "passes a -gproj launch of the 2.0 sandbox, in either form and slash style")],
    negative: [
      T(DR, "refuses a launch of anything but the sandbox, or of no project, or of two"),
      T("tests/workbench/spawned-guards.test.ts", "refuses to run with an override pointing outside the sandbox"),
      T("tests/live-harness/kernel-battery.test.ts", "refuses a plant target in the handler folder or outside the sandbox"),
      T("tests/live-harness/w6-battery.test.ts", "plant and rollback refuse a sandbox that is not the test bed"),
      T("tests/live-harness/rewalk-subeditors.test.ts", "refuses a sandbox that is not the 2.0 test bed folder"),
    ],
    note: "tests/live/*.live.ts are not collected by vitest (no .test. infix); they run only by hand with --really.",
  },
  {
    id: "deny-lists",
    name: "Deny lists (Appendix B labels, never-called APIs, denied CLI switches)",
    source: "C8 'deny-list from verified labels'; plan 5.3, Appendix B",
    impl: [
      I("data/census/policy.json", "never_called_on_live_instance"),
      I("scripts/live/dry-run.ts", "deny-listed-path"),
      I("scripts/live/policy.ts", "cli_switches"),
    ],
    positive: [T(PP, "generates a planted allow-list entry and refuses a planted deny-listed one")],
    negative: [
      T(DR, "fails an execute-action on a deny-listed path"),
      T(DR, "fails an invoke on a deny-listed label as well as on the leaf"),
      T(DR, "refuses a deny-listed switch"),
      T("tests/scripts/gen-action-allowlist.test.ts", "refuses an entry with a refused word, a deny-list label or a quote"),
      T(PP, "executeAction refuses a segment holding a deny label or a refused word", "static"),
      T(PF, "is refused without the owner-go switch, naming plan 5.7 and the owner's go"),
    ],
    note:
      "The refusal side is tested. The 'from verified labels' side is the ledger check below: the lists are the Appendix B seed, and no DECISIONS entry records the Phase 4 regeneration or the owner's sign-off (plan Appendix B, last line).",
  },
  {
    id: "runcommandline-ban",
    name: "RunCommandline ban (never on a live instance, never from a handler or a tool)",
    source: "C8; plan 5.3 'RunCommandline is never called on a live instance'",
    impl: [
      I("scripts/enforce-lint.ts", "RunCommandline"),
      I("src/tools/wb-plugin.ts", "NEVER_CALLED"),
      I("data/census/policy.json", "never_called_on_live_instance"),
    ],
    positive: [T(NR, "finds no deny-key failure in any shipped handler under mod/", "static")],
    negative: [
      T(DR, "fails a net call to an API that is never called on a live instance"),
      T(NR, "fails a planted call in a shipped handler, at its line"),
      T(NR, "fails the call through any receiver and with whitespace before the parenthesis"),
      T("tests/tools/wb-plugin.test.ts", "refuses ParticleEditor, an unknown module and the never-called entry points"),
      T("tests/contracts/EMCP_WB_Plugin.contract.test.ts", "RunCommandline and Configure are refused by name, before any lookup", "static"),
    ],
  },
  {
    id: "allow-lists",
    name: "Allow-lists (ExecuteAction proven paths only; candidates NOT_ALLOWLISTED; CLI verbs; plugin reads and runs)",
    source: "plan 5.3 'ExecuteAction only with paths on the allow-list'; DEC-100",
    impl: [
      I("src/tools/wb-menu.ts", "NOT_ALLOWLISTED"),
      I("mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_ActionAllowList.c", "Count"),
    ],
    positive: [
      T(DR, "passes an allow-listed execute-action"),
      T("tests/tools/wb-menu.test.ts", "sends an allow-listed World Editor item and names why it refuses the rest"),
    ],
    negative: [
      T("tests/scripts/gen-action-allowlist.test.ts", "wb_menu run refuses a World Editor candidate NOT_ALLOWLISTED and sends nothing"),
      T("tests/scripts/gen-action-allowlist.test.ts", "candidates are compiled into the probe pack only, never into the shipped list or a shipped handler", "static"),
      T("tests/scripts/gen-action-allowlist.test.ts", "both generators refuse a dialog opener on either list, and a path on both lists"),
      T(DR, "fails an execute-action that is not on the allow-list"),
      T("tests/tools/wb-menu.test.ts", "an empty allow-list refuses every run"),
      T("tests/tools/wb-cli-run.test.ts", "with an empty list every verb is refused NOT_ALLOWLISTED and nothing is spawned"),
      T("tests/tools/wb-plugin.test.ts", "refuses a class off the run list with NOT_ALLOWLISTED even when it is on the read list"),
      T("tests/tools/wb-bi.test.ts", "mutating, unverified and unknown names are NOT_ALLOWLISTED"),
    ],
  },
  {
    id: "confirm-dry-run",
    name: "Confirm and dry run (a mutating call without confirm writes nothing)",
    source: "plan 3.3 principles; DEC-058 ruling 2 ('The dry run without confirm: true stays')",
    impl: [
      I("src/tools/wb-container.ts", "confirm"),
      I("src/tools/config-edit.ts", "confirm"),
    ],
    positive: [
      T("tests/tools/wb-container.test.ts", "set with confirm answers changed and the read-back"),
      T("tests/tools/config-edit.test.ts", "writes exactly the announced change with confirm"),
    ],
    negative: [
      T("tests/tools/config-edit.test.ts", "is a dry run by default: the file is untouched and the change is announced"),
      T("tests/tools/wb-container.test.ts", "set without confirm is a dry run with the would-change diff, sent as mutate"),
      T("tests/tools/wb-container.test.ts", "normalises the target and path, and sends confirm false by default"),
      T("tests/tools/wb-plugin.test.ts", "is a dry run by default: confirm false, access mutate, preconditions only"),
      T("tests/live-harness/w4-battery.test.ts", "every GATED action is sent for its refusal only (a plan note says so, no confirm reaches Enforce)", "static"),
    ],
  },
  {
    id: "project-guard",
    name: "DEC-058 any-project guard (writes only inside the project carrying the handler set)",
    source: "DEC-058 rulings 1 to 3",
    impl: [
      I("mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Guard.c", "TargetExistsInProject"),
      I("mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Guard.c", "NOT_IN_PROJECT"),
    ],
    positive: [
      T(SG, "finds the project by the handler set, not by a compiled-in name (DEC-058)", "static"),
      T(SG, "TargetInsideProject admits any clean path inside the project folder, reads and writes (DEC-058)", "static"),
    ],
    negative: [
      T(SG, "TargetInsideProject checks the project, then the relative path, then containment", "static"),
      T(SG, "NewTargetInProject: clean, under the project, parent folder resolved by the engine", "static"),
      T("tests/tools/wb-container.test.ts", "surfaces the deciding guard's message and the sourceAddons list on a write refusal"),
      T("tests/tools/wb-plugin.test.ts", "maps NO_SETTER, NOT_IN_PROJECT and INVALID_ARGUMENT handler refusals"),
    ],
    note:
      "The Enforce guard cannot run offline: its negatives are source checks plus the TS mapping of its refusals. The live refusal (US.conf refused by TargetExistsInProject) is DEC-058's live proof of 2026-11-10.",
  },
  {
    id: "path-containment",
    name: "Path containment (a path outside the project, absolute or escaping, is refused)",
    source: "plan 5.3 'Save is never called on a world outside the sandbox'; DEC-058 ruling 2",
    impl: [
      I("src/utils/path-guard.ts", "resolves outside project root"),
      I("src/utils/path-guard.ts", "export function pinnedProjectRoot"),
      I("src/tools/wb-container.ts", "ABSOLUTE_PATH"),
    ],
    positive: [
      T("tests/tools/containment-h7.test.ts", "refuses projectPath outside root, writes nothing; writes inside root"),
      T("tests/tools/project-root-pin.test.ts", "reads a project folder below the root"),
    ],
    negative: [
      T("tests/tools/wb-container.test.ts", "refuses an absolute target with ABSOLUTE_PATH"),
      T("tests/tools/project-root-pin.test.ts", "leaves every outside file as it was"),
      T("tests/utils/path-guard.test.ts", "refuses a caller path outside the configured root, or with none configured"),
      T("tests/tools/containment-h7.test.ts", "refuses projectPath outside the configured root and writes nothing"),
      T("tests/tools/containment-h7.test.ts", "refuses a read outside every configured root"),
      T("tests/tools/wb-module.test.ts", "setResource refuses an absolute path before anything is sent"),
      T("tests/live-harness/snapshot.test.ts", "rejects declared paths that escape the root"),
      T("tests/live-harness/dry-run-sf-kinds.test.ts", "passes inside the sandbox and refuses outside or escaping"),
    ],
  },
  {
    id: "registry",
    name: "Registry post-flight (read by export only; no write path; HKCU only; no compare after a forced kill)",
    source: "plan 5.3 pre-flight step 5, post-flight step 3; 5.7",
    impl: [
      I("src/settings/reg-export.ts", "export"),
      I("scripts/live/preflight.ts", "export function validateRegistryKey"),
    ],
    positive: [T("tests/live-harness/postflight.test.ts", "reads a UTF-16LE export and reports added and removed lines")],
    negative: [
      T("tests/tools/wb-settings.test.ts", "the registry is never written: every reg call is an export"),
      T(NR, "every reg call in src/, scripts/ and tests/live/ is an export (no write path exists)", "static"),
      T(NR, "pre-flight exports only a per-user key: HKLM, a bare hive and a quoted key are refused"),
      T("tests/live-harness/w8-battery.test.ts", "the W8 plan check refuses a free-name drive, a commit dismiss, a registry write and a save"),
      T(PO, "is not valid when the run folder of the --before manifest records a forced kill"),
      T("tests/live-harness/s-b-scratch-profile.test.ts", "never kills, never sends keys, never writes the registry itself", "static"),
    ],
  },
  {
    id: "snapshot",
    name: "Sandbox snapshot post-flight (net-zero or explained)",
    source: "plan 5.3 pre-flight step 6, post-flight step 1",
    impl: [
      I("scripts/live/snapshot.ts", "export function takeSnapshot"),
      I("scripts/live/postflight.ts", "net-zero"),
    ],
    positive: [T(PO, "reports net-zero with expected noise and changes nothing on a dry run")],
    negative: [
      T(PO, "fails net-zero on an unexpected change and still releases with really"),
      T(PO, "fails on a new top-level file no declared path covers; the noise list can cover it"),
      T(PO, "does not hide a real difference outside _throwaway/W1/ with the W1 list"),
      T("tests/live-harness/w10-battery.test.ts", "a run that changes a sandbox file is a FAIL with no live result"),
    ],
  },
  {
    id: "probe-pack-scope",
    name: "Probe-pack scope (dev only, sandbox only, never shipped; mutating pack only for its sessions)",
    source: "plan 5.1 'The probe pack', 5.4 step 7; DEC-100 candidates",
    impl: [I("scripts/live/launch.ts", "--probe-pack")],
    positive: [T(PP, "every pack file has the ECEN_ prefix, and launch.ts accepts each pack", "static")],
    negative: [
      T(PP, "the shipped installers copy only from mod/, never from mod-dev/", "static"),
      T(PP, "no file under mod/ carries the ECEN_ prefix or declares an ECEN_ class", "static"),
      T(PP, "every action except info refuses outside the 2.0 sandbox", "static"),
      T(PF, "refuses the session at step 7 unless the queue is S-E's, P3-3's or P4-1's"),
      T(PF, "refuses the launch at step 8 too, before anything is spawned"),
      T(PO, "refuses to delete outside the 2.0 sandbox or while Workbench still runs"),
      T("tests/live-harness/w9-battery.test.ts", "under --candidates the gate stops when the probe pack does not answer on the sandbox"),
    ],
  },
  {
    id: "launch-args",
    name: "Launch arguments (-gproj only, flag-shaped paths refused, -scriptAuthorizeAll only with the go)",
    source: "plan 5.3 pre-flight step 8, 5.7; DEC-047 L7, DEC-041",
    impl: [I("src/workbench/client.ts", "export function buildWorkbenchArgs")],
    positive: [T(KT, "always passes -gproj and -scriptAuthorizeAll and never the removed forms")],
    negative: [
      T(KT, "refuses flag-shaped paths and bad names"),
      T(CG, "A-6: a non-.gproj path is refused with LAUNCH_FAILED before any handler is copied"),
      T(PF, "never comes through --extra-args, even with the owner's go"),
      T(PF, "refuses -forceSettings in the default variant before U12 has passed"),
    ],
  },
  {
    id: "launch-watchdog",
    name: "Launcher watchdog (one nudge, never a blind click on the missing-dependencies modal)",
    source: "plan 5.3 'The launcher has opened a different project than requested before'",
    impl: [I("src/workbench/launch-watchdog.ts", "missing-deps")],
    positive: [T("tests/workbench/launch-watchdog.test.ts", "never nudges when CLI Params appears in time")],
    negative: [
      T("tests/workbench/launch-watchdog.test.ts", "reports missing-deps immediately when the modal is up at nudge time"),
      T("tests/workbench/launch-watchdog.test.ts", "nudges once after the quiet threshold, then reports stuck after the grace"),
    ],
  },
  {
    id: "foreign-workbench",
    name: "Never adopt a Workbench or kill a process this session did not start",
    source: "plan 5.3 pre-flight steps 3 and 4, 5.7",
    impl: [
      I("scripts/live/preflight.ts", "export function stepWorkbenchRunning"),
      I("scripts/live/preflight.ts", "export function stepPortOwner"),
    ],
    positive: [T(PF, "accepts the Workbench this lane started")],
    negative: [
      T(PF, "stops at step 3 on a Workbench this session did not start, terminating nothing"),
      T(PF, "stops at step 4 on an orphaned CrashReporter holding the port"),
      T(PO, "keeps the lease while any Workbench image runs, whatever pid the lease holds"),
    ],
  },
];

// ── Checks ───────────────────────────────────────────────────────────────────

export interface RefResult {
  ref: TestRef | ImplRef;
  found: boolean;
  why?: string;
}

export interface MechanismResult {
  m: Mechanism;
  impl: RefResult[];
  positive: RefResult[];
  negative: RefResult[];
  /** "PAIRED": every reference resolves and a negative exists; otherwise the gap. */
  status: "PAIRED" | "NO-NEGATIVE" | "BROKEN-REF";
}

export interface FileReader {
  exists: (rel: string) => boolean;
  read: (rel: string) => string;
}

export const fsReader = (root: string = REPO): FileReader => ({
  exists: (rel) => existsSync(join(root, ...rel.split("/"))),
  read: (rel) => readFileSync(join(root, ...rel.split("/")), "utf-8"),
});

/** A test name appears in its file as a string literal in any of the three quote forms. */
export function hasTestName(text: string, name: string): boolean {
  return [`"${name}"`, `'${name}'`, `\`${name}\``].some((q) => text.includes(q));
}

function checkTest(r: TestRef, io: FileReader, cache: Map<string, string>): RefResult {
  if (!io.exists(r.file)) return { ref: r, found: false, why: "file missing" };
  const text = cache.get(r.file) ?? io.read(r.file);
  cache.set(r.file, text);
  return hasTestName(text, r.name)
    ? { ref: r, found: true }
    : { ref: r, found: false, why: "test name not in file" };
}

function checkImpl(r: ImplRef, io: FileReader, cache: Map<string, string>): RefResult {
  if (!io.exists(r.file)) return { ref: r, found: false, why: "file missing" };
  const text = cache.get(r.file) ?? io.read(r.file);
  cache.set(r.file, text);
  return text.includes(r.marker)
    ? { ref: r, found: true }
    : { ref: r, found: false, why: "marker not in file" };
}

export function auditMechanisms(ms: Mechanism[], io: FileReader = fsReader()): MechanismResult[] {
  const cache = new Map<string, string>();
  return ms.map((m) => {
    const impl = m.impl.map((r) => checkImpl(r, io, cache));
    const positive = m.positive.map((r) => checkTest(r, io, cache));
    const negative = m.negative.map((r) => checkTest(r, io, cache));
    const broken = [...impl, ...positive, ...negative].some((r) => !r.found);
    const status: MechanismResult["status"] =
      negative.filter((r) => r.found).length === 0 ? "NO-NEGATIVE" : broken ? "BROKEN-REF" : "PAIRED";
    return { m, impl, positive, negative, status };
  });
}

// ── Deny labels against the census ───────────────────────────────────────────

export interface LabelResult {
  list: string;
  label: string;
  /**
   * ui ledger rows that back the label. A plain label: rows whose label equals it. An `X:confirm`
   * label: the confirm controls (OK, Yes, Create and the like) of a dialog named X, ignoring case,
   * a trailing "..." and an ampersand; failing that, a dialog whose name starts with X; when no
   * confirm control is recorded, the dialogs themselves. The opener's own rows never count.
   */
  rows: number;
  /** Of those, rows a live census enumerator (L01 to L16) observed. */
  liveRows: number;
}

/** The deny lists' labels; a `X:confirm` entry names the confirm button of X's dialog. */
export function denyLabels(policy: unknown): Array<{ list: string; label: string }> {
  const lists = ((policy as Record<string, unknown>)?.deny_lists ?? {}) as Record<string, unknown>;
  const out: Array<{ list: string; label: string }> = [];
  for (const [list, v] of Object.entries(lists)) {
    const labels = (v as { labels?: unknown })?.labels;
    if (!Array.isArray(labels)) continue;
    for (const l of labels) if (typeof l === "string") out.push({ list, label: l });
  }
  return out;
}

const LIVE_ENUM = /^L\d{2}$/;
/** Labels a dialog's confirming control carries (the same set as deny-list-regen.ts). */
const CONFIRM_LABEL = /^(ok|yes|publish|login|log in|create|save|pack|apply|confirm|delete|remove|upload)$/i;

/** A label ignoring case, a trailing "..." or ellipsis, an ampersand and runs of spaces. */
export function looseLabel(label: string): string {
  return label
    .replace(/&/g, "")
    .replace(/\.\.\.$|…$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface UiRow {
  id?: string;
  dim?: string;
  kind?: string;
  parent?: string | null;
  label?: string;
  sources?: Array<{ enumerator?: string }>;
}

export function auditDenyLabels(policy: unknown, ledgerLines: Iterable<string>): LabelResult[] {
  const rows: UiRow[] = [];
  for (const line of ledgerLines) {
    if (!line.includes('"dim":"ui"')) continue;
    let row: UiRow;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.dim === "ui" && typeof row.label === "string") rows.push(row);
  }
  const live = (r: UiRow): boolean =>
    (r.sources ?? []).some((x) => LIVE_ENUM.test(String(x.enumerator ?? "")));
  const byParent = new Map<string, UiRow[]>();
  for (const r of rows)
    if (r.parent) (byParent.get(r.parent) ?? byParent.set(r.parent, []).get(r.parent)!).push(r);
  const count = (backing: UiRow[]): { rows: number; liveRows: number } => ({
    rows: backing.length,
    liveRows: backing.filter(live).length,
  });
  return denyLabels(policy).map((w) => {
    if (!w.label.endsWith(":confirm")) return { ...w, ...count(rows.filter((r) => r.label === w.label)) };
    const key = looseLabel(w.label.replace(/:confirm$/, ""));
    const dialogsOf = (r: UiRow): boolean => r.kind === "dialog";
    let dialogs = rows.filter((r) => dialogsOf(r) && looseLabel(r.label!) === key);
    if (!dialogs.length) dialogs = rows.filter((r) => dialogsOf(r) && looseLabel(r.label!).startsWith(`${key} `));
    const controls = dialogs.flatMap((d) =>
      (d.id ? (byParent.get(d.id) ?? []) : []).filter((c) => CONFIRM_LABEL.test(String(c.label).trim())),
    );
    // A live confirm control first; then a live dialog (its control not recorded); then whatever
    // static rows there are, controls before dialogs.
    const backing = controls.some(live)
      ? controls
      : dialogs.some(live)
        ? dialogs
        : controls.length
          ? controls
          : dialogs;
    return { ...w, ...count(backing) };
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

const refText = (r: RefResult): string => {
  const t = r.ref as TestRef;
  const kind = t.kind === "static" ? " [static]" : "";
  return `${r.found ? "" : "MISSING "}${t.file} :: ${t.name}${kind}${r.found ? "" : ` (${r.why})`}`;
};

export function renderText(results: MechanismResult[], labels: LabelResult[] | null): string {
  const lines: string[] = ["Live-safety audit (PLAN 11 criterion 8)", ""];
  for (const r of results) {
    const neg = r.negative.filter((x) => x.found).length;
    const exec = r.negative.filter((x) => x.found && (x.ref as TestRef).kind !== "static").length;
    lines.push(`[${r.status}] ${r.m.id}: ${r.m.name}`);
    lines.push(`  source: ${r.m.source}`);
    for (const i of r.impl)
      lines.push(`  impl: ${i.found ? "" : "MISSING "}${(i.ref as ImplRef).file} (${(i.ref as ImplRef).marker})`);
    for (const p of r.positive) lines.push(`  +  ${refText(p)}`);
    for (const n of r.negative) lines.push(`  -  ${refText(n)}`);
    lines.push(`  negatives: ${neg} (${exec} executed, ${neg - exec} static)`);
    if (r.m.note) lines.push(`  note: ${r.m.note}`);
    lines.push("");
  }
  if (labels) {
    lines.push("Deny labels against the census (ui rows; live = observed by L01..L16; X:confirm = the confirm control of dialog X):");
    for (const l of labels)
      lines.push(
        `  ${l.liveRows > 0 ? "verified  " : "UNVERIFIED"} ${l.list} :: ${l.label}  rows ${l.rows}, live ${l.liveRows}`,
      );
    lines.push("");
  }
  const bad = results.filter((r) => r.status !== "PAIRED");
  lines.push(
    `${results.length} mechanisms: ${results.length - bad.length} paired, ${bad.length} not` +
      (labels ? `; deny labels ${labels.filter((l) => l.liveRows > 0).length}/${labels.length} live-verified` : ""),
  );
  return lines.join("\n");
}

const md = (s: string): string => s.replace(/\|/g, "\\|");

export function renderMarkdown(results: MechanismResult[], labels: LabelResult[] | null): string {
  const out: string[] = [
    "| Mechanism | Implemented in | Positive test | Negative tests (refusal) | Status |",
    "|---|---|---|---|---|",
  ];
  for (const r of results) {
    const impl = r.impl.map((i) => `\`${(i.ref as ImplRef).file}\``).join("<br>");
    const pos = r.positive.map((p) => `\`${(p.ref as TestRef).file}\`: ${md((p.ref as TestRef).name)}`).join("<br>");
    const neg = r.negative
      .map((n) => {
        const t = n.ref as TestRef;
        return `\`${t.file}\`: ${md(t.name)}${t.kind === "static" ? " *(static)*" : ""}${n.found ? "" : " **MISSING**"}`;
      })
      .join("<br>");
    out.push(`| **${md(r.m.id)}**: ${md(r.m.name)} | ${impl} | ${pos} | ${neg} | ${r.status} |`);
  }
  if (labels) {
    out.push("", "| Deny list | Label | ui rows | live-census rows | Verified |", "|---|---|---|---|---|");
    for (const l of labels)
      out.push(`| ${l.list} | ${md(l.label)} | ${l.rows} | ${l.liveRows} | ${l.liveRows > 0 ? "yes" : "**no**"} |`);
  }
  return out.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export function run(argv: string[], io: Io = { out: console.log, err: console.error }, root = REPO): number {
  const known = new Set(["--md", "--no-ledger", "--strict-labels"]);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length) {
    io.err(`usage: live-safety.ts [--md] [--no-ledger] [--strict-labels] (unknown: ${bad.join(" ")})`);
    return 2;
  }
  const reader = fsReader(root);
  const results = auditMechanisms(MECHANISMS, reader);
  let labels: LabelResult[] | null = null;
  if (!argv.includes("--no-ledger")) {
    const policy = JSON.parse(reader.read("data/census/policy.json"));
    const ledger = reader.exists("data/census/ledger.jsonl")
      ? reader.read("data/census/ledger.jsonl").split("\n")
      : [];
    labels = auditDenyLabels(policy, ledger);
  }
  io.out(argv.includes("--md") ? renderMarkdown(results, labels) : renderText(results, labels));
  const unpaired = results.some((r) => r.status !== "PAIRED");
  const unverified = (labels ?? []).some((l) => l.liveRows === 0);
  return unpaired || (argv.includes("--strict-labels") && unverified) ? 1 : 0;
}

const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) process.exitCode = run(process.argv.slice(2));
