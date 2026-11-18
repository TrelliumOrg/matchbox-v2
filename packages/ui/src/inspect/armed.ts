/**
 * The attribute on `<html>` once the page's charts listen (`arm`). Until
 * then (the server HTML, before the page hydrates) a point or a key on a
 * chart is nobody's: end-to-end tests wait for it before they point or
 * press (`@matchbox/ui/inspect-e2e`).
 */
export const armedAttribute = "data-inspect-armed"
