import type { ManifestPage } from "@matchbox/docs/manifest"

/**
 * A page's document title and link preview title. Four product pages share
 * a title with a concept page (Borrow, Incentives, Locks, Rewards), so the
 * product page names its product, "Locks in Matchbox Pro", and every page's
 * title is its own. Concept pages keep the plain title.
 */
export default function pageTitle(
  page: ManifestPage,
  pages: Readonly<Record<string, ManifestPage>>,
): string {
  const shared = Object.values(pages).some(
    (other) => other.path !== page.path && other.title === page.title,
  )
  const title =
    shared && page.section !== "concepts"
      ? `${page.title} in ${page.eyebrow}`
      : page.title
  return `${title}, Matchbox Docs`
}
