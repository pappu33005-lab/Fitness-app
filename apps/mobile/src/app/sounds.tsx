import { useRef, useState } from "react";
import { Platform, View } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { AppText, Button, Screen, Slider } from "@/components/ui";
import { renderNoiseWav, type ProceduralSound } from "@/audio/noise";
import { copy } from "@/i18n/copy";
import { capabilities } from "@/platform/capabilities";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

const procedural: { id: ProceduralSound; label: string }[] = [
  { id: "white", label: "White noise" },
  { id: "pink", label: "Pink noise" },
  { id: "brown", label: "Brown noise" },
  { id: "fan", label: "Fan" },
  { id: "ambient", label: "Soft air" },
];

const missing = ["Rain", "Ocean", "Forest", "Guided story"];

export default function SoundsScreen() {
  const { colors } = useTheme();
  const player = useRef<AudioPlayer | null>(null);
  const blobUrl = useRef<string | null>(null);
  const [volume, setVolume] = useState(0.6);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function play(kind: ProceduralSound) {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "mixWithOthers" });
      const bytes = renderNoiseWav(kind);
      let uri: string;
      if (Platform.OS === "web") {
        if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        blobUrl.current = URL.createObjectURL(new Blob([copy], { type: "audio/wav" }));
        uri = blobUrl.current;
      } else {
        const file = new File(Paths.cache, `${kind}.wav`);
        file.write(bytes);
        uri = file.uri;
      }
      player.current?.pause();
      const next = createAudioPlayer(uri);
      next.loop = true;
      next.volume = volume;
      next.play();
      player.current = next;
      setActive(kind);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This device could not start audio.");
    }
  }

  return (
    <Screen>
      <AppText variant="h1">Sounds</AppText>
      <AppText variant="small" color={colors.textSecondary}>Noise is generated on device. Nature recordings and stories are not bundled, so they are not played.</AppText>
      {capabilities.nativeAudioSession ? null : (
        <AppText variant="caption">Browser playback previews the generated loop only. Background audio and the lock screen are part of the iOS and Android builds.</AppText>
      )}
      <View style={{ height: space.lg }} />
      <Slider label="Volume" value={volume} onChange={(value) => {
        setVolume(value);
        if (player.current) player.current.volume = value;
      }} />
      <View style={{ height: space.md }} />
      {procedural.map((sound) => (
        <View key={sound.id} style={{ marginBottom: space.sm }}>
          <Button label={active === sound.id ? `${sound.label} · playing` : sound.label} tone={active === sound.id ? "primary" : "secondary"} onPress={() => void play(sound.id)} />
        </View>
      ))}
      <Button label="Stop" tone="ghost" onPress={() => { player.current?.pause(); setActive(null); }} />
      <View style={{ height: space.lg }} />
      <AppText variant="label">Not bundled</AppText>
      {missing.map((item) => <AppText key={item} variant="small" color={colors.textMuted}>{item} · original audio is not in this build</AppText>)}
      <View style={{ height: space.md }} />
      <AppText variant="h3">Breathing</AppText>
      <AppText variant="small">Inhale 4 seconds, hold 4, exhale 6. Stop if you feel lightheaded. This is a timer in words, not a recorded guide.</AppText>
      {error ? <AppText variant="small">{error}</AppText> : null}
      <AppText variant="caption">{copy.soundModel}</AppText>
    </Screen>
  );
}
