# Version decisions

Re-checked on 25 September 2026 against the official Expo compatibility matrix. SDK 58 is a beta, so this project stays on SDK 57. No dependency was changed in this check: the installed versions already match that matrix.

## Selected stack

| Decision | Exact version | Why | Official source | Compatibility |
| --- | --- | --- | --- | --- |
| Expo SDK | 57.0.25 | npm `latest` and the `sdk-57` dist-tag. `docs.expo.dev/versions/latest` is the v57 reference. | [SDK reference](https://docs.expo.dev/versions/latest/), [npm dist-tags](https://www.npmjs.com/package/expo) (`latest` = `57.0.25`, `next` = `58.0.0-preview.6`) | SDK 58 beta targets React Native 0.88, which is still a release candidate. That is not a stable SDK, so it was not installed. |
| React Native | 0.86.3 | SDK 57 targets React Native 0.86. `expo@57.0.17` and later move that to 0.86.3. npm `latest` for `react-native` is 0.87.1, which is outside this SDK. | [SDK reference table](https://docs.expo.dev/versions/latest/), [SDK 57 changelog](https://expo.dev/changelog/sdk-57) | Do not install React Native 0.87 or the 0.88 release candidate while staying on SDK 57. |
| React | 19.2.3 | The React version in the SDK 57 row. npm `latest` is 19.3.0 and is not that peer. | [SDK reference table](https://docs.expo.dev/versions/latest/) | SDK 56 and SDK 57 both use React 19.2.3. |
| Expo Router | 57.0.23 | The `latest` version of `expo-router` published with SDK 57. | npm `expo-router` `latest` = 57.0.23 | Router versions follow the SDK. A router from SDK 58 would not be installed. |
| TypeScript | 6.0.3 | Newest 6.0 release, and the range Expo Doctor expects for this SDK (`~6.0.3`). | [expo/expo#47627](https://github.com/expo/expo/issues/47627): Expo Doctor reports `typescript ~6.0.3` expected and `7.0.2` found. The Expo team says TypeScript 7 has no public compiler API and is not supported. [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) says 7.0 runs side by side with 6.0. | npm `typescript` `latest` is 7.0.2. That package is a different compiler. It is not the version `expo install` / Expo Doctor accept. |
| Node.js | 24.21.0 | Current Active LTS (Krypton). Newest 24.x build on the Node release index as of this check. | [Node.js release schedule](https://github.com/nodejs/release): 24.x is Active LTS, 22.x is Maintenance LTS, 26.x is Current and not LTS until 2026-10-28. [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json) lists `v24.21.0` as the newest Krypton build. Expo's minimum is Node `22.13.x`. | Local development uses the Active LTS line. The EAS SDK 57 images still run Node 22.23.1. Application code must not depend on APIs that exist only in Node 24. |
| EAS CLI | 24.8.0 | npm `latest` for `eas-cli`. No store or EAS project is configured. | npm `eas-cli` `latest` = 24.8.0 | Credentials are still required before a real build. |
| Xcode | 26.6 on the SDK 57 EAS image | The documented minimum is Xcode 26.4+. The image assigned to `sdk-57` and `latest` is Xcode 26.6, not Xcode 27. | [SDK reference, Android and iOS versions](https://docs.expo.dev/versions/latest/): SDK 57, iOS 16.4+, Xcode 26.4+. [EAS infrastructure](https://docs.expo.dev/build-reference/infrastructure/): `macos-tahoe-26.5-xcode-26.6` is the `sdk-57` image. | Xcode 27 builds need the UIKit scene lifecycle. SDK 58 beta turns that on by default. On SDK 57 it is opt-in via `expo-build-properties` `ios.enableSceneSupport`, added in `expo@57.0.23` ([SDK 57 changelog](https://expo.dev/changelog/sdk-57)). This repo does not enable that flag, because the official SDK 57 image is Xcode 26.6. |
| Android compile / target SDK | 36 | The SDK 57 row. `minSdkVersion` is the only override, set to 26. | [SDK reference table](https://docs.expo.dev/versions/latest/) | Health Connect's SDK requires API 26. Kotlin, AGP, and Gradle stay on whatever `expo prebuild` emits for SDK 57. |
| EAS Android image | `ubuntu-26.04-jdk-17-ndk-r27b-sdk-57` | The image aliased to `sdk-57`. | [EAS infrastructure](https://docs.expo.dev/build-reference/infrastructure/) | NDK r27b, JDK 17, Node 22.23.1, pnpm 11.9.0 on that image. Local installs use pnpm 12.6.0. |

## Re-checked 1 October 2026

`npx expo-doctor` against the installed tree reported patch drift inside SDK 57. `npx expo install` then aligned:

| Package | After alignment |
| --- | --- |
| expo | 57.0.26 |
| @expo/ui | 57.0.21 |
| expo-camera | 57.0.6 |
| expo-constants | 57.0.20 |
| expo-router | 57.0.24 |
| expo-task-manager | 57.0.21 |
| expo-asset | 57.0.18 (direct dependency; required peer of expo-audio) |
| @maplibre/maplibre-react-native | 11.4.0 |

Node on the machine that ran these commands was 22.14.0. The project `engines` field still allows Node >= 22.13.0. pnpm was 12.6.0.

## Not selected

- Expo SDK 58. npm tag `next` is `58.0.0-preview.6`. The [SDK 58 beta announcement](https://expo.dev/changelog/sdk-58-beta) says the beta uses the React Native 0.88 release candidate and lasts three to four weeks. Stable release notes are not published yet.
- Node.js 26. It is the Current line, not LTS, until 28 October 2026.
- TypeScript 7.0.2. It is the npm `latest` compiler, and Expo does not accept it for this SDK.
- React Native 0.87.1 and React 19.3.0. Those are newer npm releases than the SDK 57 peers.
