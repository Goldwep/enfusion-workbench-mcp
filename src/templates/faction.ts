/**
 * Faction .conf rendering shared by `faction_create` and `config_create`
 * (configType "faction").
 *
 * The property names are the engine's serialized attribute names, read from
 * vanilla Configs/Factions/*.conf (US.conf, CIV.conf, BLUFOR.conf, Dummy.conf
 * in the game paks). `FactionKey`, `FactionColor` and `UIInfo` belong to the
 * native `Faction` class, so they carry no `m_` prefix; the display name sits
 * on the UIInfo object (`Name`), not on the faction. The flag texture is the
 * SCR_Faction script member `m_sFactionFlag`. Vanilla shape:
 *
 *     SCR_Faction {
 *      FactionKey "CIV"
 *      FactionColor 0.392 0.157 0.624 1
 *      UIInfo SCR_FactionUIInfo "{56B49118D8D0A9C5}" {
 *       Name "#AR-Faction_CIV"
 *      }
 *      m_sFactionFlag "{76A2D42714BB3806}UI/Textures/Flags/Civilian-flag-base_3it.edds"
 *     }
 *
 * Text is emitted by hand rather than through `serialize()`: the shared
 * serializer writes ALL-UPPERCASE strings bare (`FactionKey US`), and vanilla
 * quotes the key.
 */

import {
  createNode,
  setProperty,
  type EnfusionNode,
} from "../formats/enfusion-text.js";
import { generateGuid } from "../formats/guid.js";

/** Color with 0-255 channels; alpha defaults to 255 (opaque). */
export interface FactionColor255 {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FactionRenderOptions {
  factionKey: string;
  displayName: string;
  color: FactionColor255;
  /** Optional flag texture resource (written as `m_sFactionFlag`). */
  flagPath?: string;
  /** UIInfo instance GUID without braces; generated when omitted. */
  uiInfoGuid?: string;
}

/** One 0-255 channel as the engine's 0-1 float, at most 3 decimals (vanilla precision). */
export function channelToUnit(value: number): string {
  return String(Number((value / 255).toFixed(3)));
}

/** `FactionColor` value: four space-separated 0-1 floats, R G B A. */
export function formatFactionColor(color: FactionColor255): string {
  return [color.r, color.g, color.b, color.a ?? 255].map(channelToUnit).join(" ");
}

function escapeQuoted(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

/** The node tree of a faction .conf (for tests and callers that edit the tree). */
export function buildFactionNode(opts: FactionRenderOptions): EnfusionNode {
  const root = createNode("SCR_Faction");
  setProperty(root, "FactionKey", opts.factionKey);
  setProperty(root, "FactionColor", formatFactionColor(opts.color));
  const ui = createNode("UIInfo", { id: `{${opts.uiInfoGuid ?? generateGuid()}}` });
  ui.className = "SCR_FactionUIInfo";
  setProperty(ui, "Name", opts.displayName);
  root.children.push(ui);
  if (opts.flagPath) setProperty(root, "m_sFactionFlag", opts.flagPath);
  return root;
}

/** Render the faction .conf text in the vanilla shape, string values always quoted. */
export function renderFactionText(opts: FactionRenderOptions): string {
  const guid = opts.uiInfoGuid ?? generateGuid();
  const lines: string[] = [];
  lines.push("SCR_Faction {");
  lines.push(` FactionKey "${escapeQuoted(opts.factionKey)}"`);
  lines.push(` FactionColor ${formatFactionColor(opts.color)}`);
  lines.push(` UIInfo SCR_FactionUIInfo "{${guid}}" {`);
  lines.push(`  Name "${escapeQuoted(opts.displayName)}"`);
  lines.push(" }");
  if (opts.flagPath) lines.push(` m_sFactionFlag "${escapeQuoted(opts.flagPath)}"`);
  lines.push("}");
  return lines.join("\n");
}
