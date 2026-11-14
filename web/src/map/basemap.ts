// Basemap (F17). WS1 owns web/public/data/tiles/basemap/ (XYZ PNG tiles of the HiRISE ortho);
// contracts v1.0 leave the layout, zoom range and bounds to WS1 ("Basemap tiles" in
// contracts/README.md), so until that is fixed the console shows a plain placeholder background.
// Mars lon/lat go straight through the XYZ (Web Mercator tile) scheme (SPEC §4.2, D4); distances on
// screen come only from the Mars scale bar (scale.ts), never from MapLibre's Earth metres.

/** A MapLibre raster source description for the basemap, once its layout is in the contract. */
export interface BasemapSource {
  tiles: string[]
  tileSize: number
  minzoom: number
  maxzoom: number
  bounds: [number, number, number, number]
  attribution?: string
}

/** Credit line for the HiRISE basemap (HiRISE image-use policy). */
export const BASEMAP_CREDIT = 'HiRISE: NASA/JPL/University of Arizona'

/** Why the placeholder is shown (legend and layer list). */
export const BASEMAP_PLACEHOLDER_NOTE = 'placeholder: HiRISE tiles from WS1 not in the contract yet'
