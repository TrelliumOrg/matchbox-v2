/**
 * Runs before first paint. Reads the stored mode and presets and sets
 * data-theme on <html> so the ground never flashes. The real resolver lives
 * in @matchbox/tokens; the spike keeps its own copy so it measures Start alone.
 */
export const themeScript = `(function(){var d=document.documentElement;try{var s=localStorage,m=s.getItem("mbx-mode")||"system",l=s.getItem("mbx-light")||"paper",k=s.getItem("mbx-dark")||"graphite",dark=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=dark?k:l}catch(e){d.dataset.theme="paper"}})()`
