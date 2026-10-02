# Route maps

Status: implemented in code. Not run on any device, emulator, or browser. Nothing here is
"working" until it has been checked on a physical iPhone and Android phone.

## What is drawn

- **Route outline** (always available). Drawn with `react-native-svg` from the points stored in
  `activity_points`. No network, no account, no configuration. Works in the browser preview.
  It has no roads or labels.
- **Base map** (optional, iOS and Android only). MapLibre draws tiles from a style URL you
  provide, with the route line on top. While tiles load, fail, or the phone is offline, the
  outline stays visible and a note says why.

If the base map is not configured, not installed in the build, or not supported (browser), the
outline is shown with the reason. Nothing falls back to a public tile server.

## Provider choice

MapLibre, through `@maplibre/maplibre-react-native`, for both phones. The library is open source
and has no subscription. Tiles are the part that can cost money: you choose the style provider
and its terms. Apple MapKit would be free on iOS but needs a second library and a second code
path, so it was not used. `expo-maps` was rejected because it uses Google Maps on Android.

## Configuration

| Item | Value |
| --- | --- |
| `EXPO_PUBLIC_MAP_TILE_STYLE_URL` | HTTPS MapLibre style URL. Empty means outline only. `http://` is rejected. |
| Dependency | `@maplibre/maplibre-react-native` **11.4.0**, installed with `npx expo install` on 1 Oct 2026. Peers: Expo >= 54, React Native >= 0.80. This repo is Expo SDK 57 and React Native 0.86.3. |
| Expo config plugin | `"@maplibre/maplibre-react-native"` is in `app.config.ts`. The plugin is required for the iOS Podfile hook. |
| Expo Go | Not supported. It is a native module. |
| Development build | Required, and it must be rebuilt after installing the package. |
| iOS / Android | No API key is needed by the library itself. Any key belongs to the tile provider and, if it sits in the URL, is visible in the app. Restrict it to this app. |
| Web preview | Outline only. |

`src/components/route-map/TileMap.tsx` calls the installed v11 API (`Map`, `Camera`, `GeoJSONSource`, `Layer`). `line-cap` and `line-join` are layout properties in the style spec. The module is loaded with `require` inside try/catch, so a failed JavaScript load keeps the SVG outline. Tiles still need a development build; this environment did not produce one.

## Behavior

- **Live recording.** `record.tsx` passes its existing `points` state to `RouteMap`. No second GPS
  source is used: the "current position" dot is the newest stored route point, so the map never
  requests location on its own and never asks for permission. Points are the ones Phase 3 already
  persists; nothing is written by the map.
- **Duplicates.** Consecutive identical coordinates are dropped for drawing only.
- **Bad coordinates.** Missing, NaN, out of range, or exactly 0,0 points are skipped for drawing.
  The stored rows are not changed.
- **Long routes.** Drawn as one line simplified to at most 600 vertices (Douglas-Peucker). The
  simplification is display only; SQLite keeps every recorded point.
- **Completed routes.** `activity/[id]` reads the session and its points from SQLite and fits the
  whole route. It needs no network or account. History cards have a "View route" button.
- **Empty route.** A short message; no crash and no invented route.
- **Backgrounding.** Route rebuilding pauses while the app is backgrounded and resumes on return.
- **Permission denied / GPS unavailable.** Handled by the recording screen from Phase 3. The map
  shows "waiting for the first GPS point" until a real point exists.
- **Tile load failure or offline.** After a load error or 12 seconds without a loaded style, the
  outline stays and a note says tiles could not load. The saved route is unaffected.

## Privacy

- The route is drawn on the device. It is not sent to any map provider.
- The tile host sees what any map view reveals: requests for the tiles covering the visible area
  (roughly where the person is looking), plus the device's IP address. Choose a provider whose
  terms you accept.
- No coordinates are logged, and no analytics event contains coordinates.
- Location data still syncs to your own Supabase project through the Phase 2 worker, as before.

## Verified and unverified

Executed here: 17 checks of the route logic in `packages/domain/src/route.test.ts` (valid points,
invalid coordinates, empty route, duplicates, bounds, simplification, viewport projection, tile
availability rules), run under `ts-node` with a small stand-in for Vitest.

Not run: `pnpm test`, `pnpm typecheck`, lint, Metro bundling, the outline on any device, the
MapLibre component, the detail screen, and everything in the list above.

Needs a device: tiles rendering, the line drawn over tiles, camera following during a real
recording, fitting a saved route, the offline note, and behavior after backgrounding.
