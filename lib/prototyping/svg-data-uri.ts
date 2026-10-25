// An SVG string as a data: URI for <img src>. Inside an <img> an SVG is inert:
// no script, event handler or foreignObject HTML runs, and it cannot reach the
// page. Use this for any SVG that was stored and read back (audit WEB-01)
// instead of injecting the markup into the DOM.

export const SVG_DATA_URI_PREFIX = "data:image/svg+xml;charset=utf-8,";

export function svgDataUri(svg: string): string {
  return SVG_DATA_URI_PREFIX + encodeURIComponent(svg);
}
