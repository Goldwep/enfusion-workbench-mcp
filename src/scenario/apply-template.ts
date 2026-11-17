/**
 * Stamp a curated `templates.ts` template into a scenario layer's text by
 * inserting the template's entities after the layer's existing entities.
 *
 * Works on the lossless CST through `layer-cst.ts`: the result is the
 * original text with one inserted span, so every existing byte (line ends,
 * indents, comments, block order, a missing final line end) is kept. The
 * inserted blocks take the file's line end and indent unit.
 *
 * Pure: no FS, no MCP. Tool wrapper owns I/O.
 */

import { insertEntities, openLayer } from "./layer-cst.js";
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
  /** As `openLayer`: true for a `.conf` / `.ent` target (insert inside its single root). */
  singleRoot?: boolean;
}

export interface AppliedTemplate extends ApplyTemplateResult {
  /** The target text with the template's entities inserted. */
  text: string;
  /** Final stamped position (echoes the input). */
  position: Position;
  /** Final yaw rotation in degrees (echoes the input). */
  yawDeg: number;
  /** Count of entities appended to the target. */
  entityCount: number;
}

/**
 * Build the template's entities and insert them as new entities of the
 * target: at the end of a `.layer`, or before the closing brace of a single
 * root (`singleRoot`). The input text is not changed; the result carries the
 * new text and the metadata for the caller.
 *
 * The append-only model is deliberate: the template's entities are valid
 * top-level nodes. Inserting elsewhere (inside an existing `$grp`) would
 * need reasoning about prefab inheritance, out of scope here.
 */
export function applyTemplate(
  targetText: string | Uint8Array,
  opts: ApplyTemplateOptions,
): AppliedTemplate {
  const layer = openLayer(targetText, { singleRoot: opts.singleRoot });
  const result = buildTemplate(opts.template, opts.position, opts.yawDeg);
  return {
    text: insertEntities(layer, result.entities),
    entities: result.entities,
    placeholders: result.placeholders,
    position: opts.position,
    yawDeg: opts.yawDeg,
    entityCount: result.entities.length,
  };
}
