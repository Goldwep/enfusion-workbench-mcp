import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  ParsedAgf,
  ParsedAgr,
  ParsedAsi,
  ValidationResult,
  ValidationIssue,
} from "./types.js";

const POST_EVAL_FUNCTIONS = [
  "RemainingTimeLess",
  "IsEvent",
  "IsTag",
  "GetLowerTime",
  "LowerNTimePassed",
  "GetRemainingTime",
  "GetEventTime",
  "GetLowerRTime",
];

/** Required GlobalTags entries for a character AGR (V15). */
const REQUIRED_GLOBAL_TAGS = ["WEAPON", "STANCE"];

/** PascalCase pattern: leading uppercase, then letters/digits only (V16). */
const PASCAL_CASE_RE = /^[A-Z][A-Za-z0-9]+$/;

/**
 * Extra context for the V14–V18 rule family. All fields are optional — when
 * absent, the corresponding rules are silently skipped. Keeps `validateGraph`
 * backward-compatible with callers that only pass parsed structs.
 */
export interface ValidateGraphOptions {
  /** Raw AGR text. Required for V14 (detects whether `GlobalTags` block exists at all). */
  agrContent?: string;
  /** Absolute or repo-relative path to the AGR file, used for relative path resolution. */
  agrPath?: string;
  /**
   * Project root used to resolve referenced .anm files for V17. When omitted,
   * .anm existence checks are skipped (graceful degradation).
   */
  projectRoot?: string;
  /**
   * Loaded skeleton context for V18 — the set of bones the skeleton exposes.
   * When omitted, the bone-remap check is skipped.
   */
  skeleton?: { bones: string[] };
}

/**
 * Resolve a possibly-{GUID}-prefixed resource path to an absolute disk path.
 * Strips the brace+GUID prefix and resolves the remainder against `projectRoot`.
 * Returns `null` for empty paths.
 */
function resolveAnmPath(rawPath: string, projectRoot: string): string | null {
  const stripped = rawPath.replace(/^\{[^}]+\}/, "");
  if (stripped === "") return null;
  return isAbsolute(stripped) ? stripped : resolve(projectRoot, stripped);
}

/** Crude detector for an `m_BoneRemap { ... }` block — captures bone names referenced inside. */
function extractBoneRemapReferences(agrContent: string): { hasBlock: boolean; bones: string[] } {
  const blockRe = /m_BoneRemap[ \t]*\{/m;
  const startMatch = agrContent.match(blockRe);
  if (!startMatch || startMatch.index === undefined) {
    return { hasBlock: false, bones: [] };
  }
  // Brace-match starting just after the opening `{`.
  const openIdx = agrContent.indexOf("{", startMatch.index);
  let depth = 1;
  let i = openIdx + 1;
  while (i < agrContent.length && depth > 0) {
    if (agrContent[i] === "{") depth++;
    else if (agrContent[i] === "}") depth--;
    i++;
  }
  const inner = agrContent.slice(openIdx + 1, i - 1);
  const bones: string[] = [];
  // Bone references can appear in entry blocks like `m_sSource "BoneName"` or as
  // standalone quoted strings — accept either.
  const re = /(?:m_s(?:Source|Target|From|To)[ \t]+)?"([^"\n\r]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    bones.push(m[1]);
  }
  return { hasBlock: true, bones };
}

export function validateGraph(
  agf: ParsedAgf,
  agr?: ParsedAgr,
  asi?: ParsedAsi,
  agfPath?: string,
  options?: ValidateGraphOptions,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const sheet of agf.sheets) {
    // V04: Duplicate node names
    const namesSeen = new Set<string>();
    for (const node of sheet.nodes) {
      if (namesSeen.has(node.name)) {
        issues.push({
          id: "V04",
          severity: "error",
          message: `Duplicate node name "${node.name}" in sheet "${sheet.name}"`,
        });
      }
      namesSeen.add(node.name);
    }

    // V05: Orphan nodes
    const allChildRefs = new Set<string>();
    for (const node of sheet.nodes) {
      for (const child of node.children) allChildRefs.add(child);
    }
    for (const node of sheet.nodes) {
      const isRootLike =
        node.type === "AnimSrcNodeQueue" ||
        node.type === "AnimSrcNodeFunctionBegin" ||
        sheet.nodes.indexOf(node) === 0;
      if (!allChildRefs.has(node.name) && !isRootLike) {
        issues.push({
          id: "V05",
          severity: "warning",
          message: `Orphan node "${node.name}" is not referenced by any parent node`,
        });
      }
    }

    for (const node of sheet.nodes) {
      // StateMachine checks
      if (node.type === "AnimSrcNodeStateMachine") {
        const states = (node.properties.states ?? []) as Array<Record<string, unknown>>;
        const transitions = (node.properties.transitions ?? []) as Array<Record<string, unknown>>;

        // V03: No catch-all state
        if (states.length > 0) {
          const lastState = states[states.length - 1];
          if (lastState.startCondition !== "1") {
            issues.push({
              id: "V03",
              severity: "warning",
              message: `StateMachine "${node.name}": no catch-all state (StartCondition "1")`,
            });
          }
        }

        for (const t of transitions) {
          // V01: Integer Duration
          const dur = t.duration as string | null;
          if (dur !== null && dur !== undefined && /^\d+$/.test(dur)) {
            issues.push({
              id: "V01",
              severity: "error",
              message: `Transition "${t.from} -> ${t.to}": Duration is integer (${dur}) -- must be decimal (${dur}.0)`,
            });
          }

          // V02: Missing PostEval
          const cond = (t.condition as string) ?? "";
          if (!t.postEval && POST_EVAL_FUNCTIONS.some((fn) => cond.includes(fn))) {
            const fn = POST_EVAL_FUNCTIONS.find((fn) => cond.includes(fn));
            issues.push({
              id: "V02",
              severity: "warning",
              message: `Transition "${t.from} -> ${t.to}": condition uses ${fn}() but PostEval is not enabled`,
            });
          }
        }

        // V12: State Time mode mismatch
        for (const state of states) {
          const childName = state.child as string | null;
          if (childName && state.timeMode) {
            const childNode = sheet.nodes.find((n) => n.name === childName);
            if (childNode) {
              const childIsSM = childNode.type === "AnimSrcNodeStateMachine";
              if (state.timeMode === "Notime" && !childIsSM) {
                issues.push({
                  id: "V12",
                  severity: "warning",
                  message: `State "${state.name}" in "${node.name}": Notime but child "${childName}" is not a StateMachine`,
                });
              }
              if (state.timeMode !== "Notime" && childIsSM) {
                issues.push({
                  id: "V12",
                  severity: "warning",
                  message: `State "${state.name}" in "${node.name}": nested StateMachine "${childName}" should use Notime on parent state`,
                });
              }
            }
          }
        }
      }

      // V08: 2-part Source format
      if (node.type === "AnimSrcNodeSource") {
        const src = node.properties.source as string | undefined;
        if (src) {
          const parts = src.split(".");
          if (parts.length === 2) {
            issues.push({
              id: "V08",
              severity: "error",
              message: `Source "${node.name}": uses 2-part format "${src}" -- needs 3-part "Group.Column.Anim"`,
            });
          }
        }
      }

      // V09: $Time in ProcTransform
      if (node.type === "AnimSrcNodeProcTransform") {
        const boneItems = (node.properties.boneItems ?? []) as Array<Record<string, unknown>>;
        for (const bi of boneItems) {
          const amount = (bi.amount as string) ?? "";
          if (amount.includes("$Time")) {
            issues.push({
              id: "V09",
              severity: "error",
              message: `ProcTransform "${node.name}": Amount uses $Time -- should be GetUpperRTime()`,
            });
          }
        }
      }

      // V11: BlendN threshold order
      if (node.type === "AnimSrcNodeBlendN") {
        const thresholds = (node.properties.thresholds ?? []) as string[];
        const nums = thresholds.map(Number);
        for (let i = 1; i < nums.length; i++) {
          if (nums[i] < nums[i - 1]) {
            issues.push({
              id: "V11",
              severity: "error",
              message: `BlendN "${node.name}": thresholds not in ascending order`,
            });
            break;
          }
        }
      }
    }
  }

  // Cross-reference checks (require AGR)
  if (agr) {
    // V06: DefaultRunNode mismatch
    if (agr.defaultRunNode) {
      const allQueueNames = agf.sheets.flatMap((s) =>
        s.nodes.filter((n) => n.type === "AnimSrcNodeQueue").map((n) => n.name),
      );
      if (!allQueueNames.includes(agr.defaultRunNode)) {
        issues.push({
          id: "V06",
          severity: "error",
          message: `DefaultRunNode "${agr.defaultRunNode}" does not match any Queue node in the AGF`,
        });
      }
    }

    // V07: AGF not registered in AGR
    if (agfPath) {
      const agfBasename = agfPath.replace(/\\/g, "/").split("/").pop() ?? agfPath;
      const registered = agr.agfReferences.some(
        (ref) => ref.replace(/\\/g, "/").split("/").pop() === agfBasename,
      );
      if (!registered) {
        issues.push({
          id: "V07",
          severity: "error",
          message: `AGF "${agfPath}" is not listed in AGR GraphFilesResourceNames`,
        });
      }
    }

    // V10: IK chain mismatch
    const agrChainNames = new Set(agr.ikChains.map((c) => c.name));
    for (const sheet of agf.sheets) {
      for (const node of sheet.nodes) {
        if (node.type === "AnimSrcNodeIK2") {
          const chains = (node.properties.chains ?? []) as Array<Record<string, unknown>>;
          for (const chain of chains) {
            const chainName = chain.ikChain as string;
            if (chainName && !agrChainNames.has(chainName)) {
              issues.push({
                id: "V10",
                severity: "warning",
                message: `IK2 "${node.name}": references chain "${chainName}" not defined in AGR`,
              });
            }
          }
        }
      }
    }
  }

  // V13: Unmapped Source animation (requires ASI)
  if (asi) {
    for (const sheet of agf.sheets) {
      for (const node of sheet.nodes) {
        if (node.type === "AnimSrcNodeSource") {
          const src = node.properties.source as string | undefined;
          if (src && src.split(".").length === 3) {
            const [group, column, anim] = src.split(".");
            const mapping = asi.mappings.find(
              (m) => m.group === group && m.column === column && m.animation === anim,
            );
            if (!mapping || mapping.anmPath === null) {
              issues.push({
                id: "V13",
                severity: "warning",
                message: `Source "${node.name}": animation "${src}" has no mapping in ASI`,
              });
            }
          }
        }
      }
    }
  }

  // V14: Character AGR missing GlobalTags block.
  //
  // Detection requires the raw AGR text — `extractStringArray` returns an empty
  // array for both "block missing" and "block present but empty", so we can't
  // distinguish from the parsed struct alone. Skipped silently when `agrContent`
  // is not provided.
  if (agr && options?.agrContent) {
    if (!/^[ \t]*GlobalTags[ \t]*\{/m.test(options.agrContent)) {
      issues.push({
        id: "V14",
        severity: "warning",
        message:
          "Character AGR is missing a GlobalTags block — required for state-machine conditions that reference tags",
      });
    }
  }

  // V15: GlobalTags must contain WEAPON and STANCE.
  //
  // Fires only when an AGR is supplied. Uses the parsed `globalTags` array so
  // it works whether or not raw `agrContent` was provided. The check is
  // case-sensitive — Enfusion tag names are conventionally ALL-CAPS.
  if (agr) {
    const present = new Set(agr.globalTags);
    for (const required of REQUIRED_GLOBAL_TAGS) {
      if (!present.has(required)) {
        issues.push({
          id: "V15",
          severity: "error",
          message: `Character AGR GlobalTags is missing required entry "${required}"`,
        });
      }
    }
  }

  // V16: AGF state-machine state nodes named in non-PascalCase form.
  //
  // States nest inside `AnimSrcNodeStateMachine.properties.states`; we check
  // each state's `name`. Empty/blank names are skipped (a separate concern).
  for (const sheet of agf.sheets) {
    for (const node of sheet.nodes) {
      if (node.type !== "AnimSrcNodeStateMachine") continue;
      const states = (node.properties.states ?? []) as Array<Record<string, unknown>>;
      for (const state of states) {
        const stateName = state.name as string | undefined;
        if (!stateName || stateName.trim() === "") continue;
        if (!PASCAL_CASE_RE.test(stateName)) {
          issues.push({
            id: "V16",
            severity: "warning",
            message: `State "${stateName}" in "${node.name}" should be PascalCase (e.g., "WalkForward", not "${stateName}")`,
          });
        }
      }
    }
  }

  // V17: Referenced .anm clip files (via ASI mappings) must exist on disk.
  //
  // Each ASI mapping points at a `{GUID}path/to/clip.anm`. We strip the brace
  // prefix and check disk existence relative to `projectRoot`. Skipped entirely
  // when either ASI or `projectRoot` is absent — both are required to attribute
  // missing files meaningfully.
  if (asi && options?.projectRoot) {
    const seenMissing = new Set<string>();
    for (const mapping of asi.mappings) {
      if (mapping.anmPath === null || mapping.anmPath === "") continue;
      const abs = resolveAnmPath(mapping.anmPath, options.projectRoot);
      if (abs === null) continue;
      if (seenMissing.has(abs)) continue; // de-dup repeats across mappings
      if (!existsSync(abs)) {
        seenMissing.add(abs);
        issues.push({
          id: "V17",
          severity: "error",
          message: `Referenced .anm clip not found on disk: ${mapping.anmPath} (resolved to ${abs})`,
        });
      }
    }
  }

  // V18: m_BoneRemap entries reference bones that don't exist in the skeleton.
  //
  // The parser doesn't expose `m_BoneRemap`, so we scan the raw AGR text when
  // available. Without skeleton context (`options.skeleton`) we can't make a
  // call either way — skip silently.
  if (options?.agrContent && options.skeleton) {
    const { hasBlock, bones } = extractBoneRemapReferences(options.agrContent);
    if (hasBlock) {
      const skeletonBones = new Set(options.skeleton.bones);
      const flagged = new Set<string>();
      for (const bone of bones) {
        if (skeletonBones.has(bone)) continue;
        if (flagged.has(bone)) continue;
        flagged.add(bone);
        issues.push({
          id: "V18",
          severity: "warning",
          message: `m_BoneRemap references bone "${bone}" which is not present in the skeleton`,
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return { issues, errorCount, warningCount };
}
