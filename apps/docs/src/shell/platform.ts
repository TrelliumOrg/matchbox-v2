import { platformAttribute } from "@matchbox/ui/kbd"

/**
 * Key caps follow the OS (matchbox-v3): ⌘ K on macOS and iOS, ctrl K
 * elsewhere. Other apps stamp `<html data-platform>` on the server; a
 * static page decides in the browser before paint. The caps share a width,
 * so nothing moves either way.
 */
export const platformScript = `try{var n=navigator,p=(n.userAgentData&&n.userAgentData.platform)||n.platform||"";document.documentElement.setAttribute("${platformAttribute}",/mac|iphone|ipad|ipod|ios/i.test(p)?"mac":"other")}catch(e){}`
