/**
 * Stamp a curated `templates.ts` template into a parsed layer root by
 * appending the template's entities as new top-level children.
 *
 * Pure — no FS, no MCP. Tool wrapper owns I/O.
 */

import type { EnfusionNode } from "../formats/enfusion-text.js";
import {
  buildTemplate,
  type ApplyTemplateResult,
  type Position,
  type TemplateName,
} from "./templates.js";

export interface ApplyTemplateOptions {
  template: TemplateName;
  position: Position;
  /** Yaw rotation in degrees, applied around the Y axis at `position`. */
  yawDeg: number;
}

export interface AppliedTemplate extends ApplyTemplateResult {
  /** Final stamped position (echoes the input). */
  position: Position;
  /** Final yaw rotation in degrees (echoes the input). */
  yawDeg: number;
  /** Count of entities appended to the target. */
  entityCount: number;
}

/**
 * Build the template's entities and APPEND them to the target's top-level
 * children. Mutates `target` in place AND returns metadata for the caller.
 *
 * The append-only model is deliberate: the target layer is a sequence of
 * top-level nodes, and the template's entities are themselves valid
 * top-level nodes. Inserting elsewhere (e.g., inside an existing `$grp`)
 * would require reasoning about prefab inheritance — out of scope here.
 */
export function applyTemplate(target: EnfusionNode, opts: ApplyTemplateOptions): AppliedTemplate {
  const result = buildTemplate(opts.template, opts.position, opts.yawDeg);
  for (const entity of result.entities) {
    target.children.push(entity);
  }
  return {
    entities: result.entities,
    placeholders: result.placeholders,
    position: opts.position,
    yawDeg: opts.yawDeg,
    entityCount: result.entities.length,
  };
}
