import { SearchResults } from "@matchbox/stuart-ui/search"

/**
 * The bar's results sheet, its search client and zod, in their own chunk:
 * loaded on the first hover, focus, touch or Ctrl K, never on first paint.
 */
export default SearchResults
