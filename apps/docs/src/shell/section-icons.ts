import type { SectionIcon, SectionId } from "@matchbox/docs/site"
import { type GlyphShape, shapes } from "@matchbox/ui/icons"

/** The Lucide glyph for each product in the header row, and named icons in content. */

const bySectionIcon: Record<SectionIcon, GlyphShape> = {
  house: shapes.house,
  shapes: shapes.shapes,
  vote: shapes.vote,
  "scan-search": shapes.scanSearch,
  "circle-user-round": shapes.circleUserRound,
  "code-xml": shapes.codeXml,
  dog: shapes.dog,
}

const named: Record<string, GlyphShape> = {
  wrench: shapes.wrench,
  "chevron-right": shapes.chevronRight,
  "file-text": shapes.fileText,
}

const sectionIcons: Record<SectionId, SectionIcon> = {
  home: "house",
  concepts: "shapes",
  pro: "vote",
  scan: "scan-search",
  id: "circle-user-round",
  developer: "code-xml",
  stuart: "dog",
}

export function iconOf(icon: SectionIcon): GlyphShape {
  return bySectionIcon[icon]
}

/** A named icon when given and known, else the section's. */
export function sectionIcon(section: SectionId, name?: string): GlyphShape {
  if (name !== undefined) {
    const shape = named[name]
    if (shape !== undefined) return shape
  }
  return bySectionIcon[sectionIcons[section]]
}
