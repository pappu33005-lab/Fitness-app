import { useState } from "react";
import { Platform, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams } from "expo-router";
import { deviceTimeZone, localDay } from "@vitacore/domain";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { logFood, type MealName } from "@/data/logs";
import { productByBarcode, type FoodHit } from "@/nutrition/openFoodFacts";
import { copy } from "@/i18n/copy";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

function isMealName(value: string | string[] | undefined): value is MealName {
  const meal = Array.isArray(value) ? value[0] : value;
  return meal === "breakfast" || meal === "lunch" || meal === "dinner" || meal === "snack";
}

export default function ScanScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ meal?: string }>();
  const meal: MealName = isMealName(params.meal) ? params.meal : "lunch";
  const [permission, requestPermission] = useCameraPermissions();
  const [hit, setHit] = useState<FoodHit | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (Platform.OS === "web") {
    return (
      <Screen>
        <AppText variant="h1">Barcode</AppText>
        <AppText variant="body">Scanning uses the device camera in the iOS and Android app. This browser cannot scan a package.</AppText>
      </Screen>
    );
  }

  function resetScan() {
    setHit(null);
    setMiss(null);
    setManualName("");
    setManualKcal("");
    setLocked(false);
    setBusy(false);
    setSaving(false);
    setError(null);
  }

  async function onScan(code: string) {
    if (locked || busy || saving) return;
    setLocked(true);
    setBusy(true);
    setMiss(null);
    setHit(null);
    setError(null);
    try {
      const product = await productByBarcode(code);
      if (!product) {
        setMiss(code);
      } else {
        setHit(product);
      }
    } catch (reason) {
      setMiss(reason instanceof Error ? reason.message : "The lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveHit(product: FoodHit) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await logFood({
        day: localDay(new Date(), deviceTimeZone()),
        timezone: deviceTimeZone(),
        meal,
        name: product.name,
        source: "barcode",
        sourceId: product.id,
        servings: 1,
        kcal: product.kcal,
        proteinG: product.proteinG,
        carbsG: product.carbsG,
        fatG: product.fatG,
        fiberG: product.fiberG,
        sugarG: product.sugarG,
        sodiumMg: product.sodiumMg,
      });
      resetScan();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This food could not be saved.");
      setSaving(false);
    }
  }

  async function saveCustom() {
    if (saving) return;
    const name = manualName.trim();
    if (!name) {
      setError("Enter a food name.");
      return;
    }
    const kcal = Number(manualKcal.trim());
    if (!Number.isFinite(kcal) || kcal < 0) {
      setError("Enter a valid non-negative calorie amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await logFood({
        day: localDay(new Date(), deviceTimeZone()),
        timezone: deviceTimeZone(),
        meal,
        name,
        source: "custom",
        sourceId: miss,
        servings: 1,
        kcal,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        sodiumMg: null,
      });
      resetScan();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This food could not be saved.");
      setSaving(false);
    }
  }

  return (
    <Screen scroll={false}>
      <AppText variant="h1">Scan</AppText>
      <AppText variant="caption">Logging for {meal}</AppText>
      {!permission?.granted ? (
        <View style={{ gap: space.md }}>
          <AppText variant="small">The camera is used to read a barcode, then the code is looked up in Open Food Facts.</AppText>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        </View>
      ) : (
        <View style={{ flex: 1, gap: space.md }}>
          <CameraView
            style={{ flex: 1, borderRadius: 24, overflow: "hidden" }}
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
            onBarcodeScanned={locked || busy || saving ? undefined : ({ data }) => void onScan(data)}
          />
          {hit ? (
            <View>
              <AppText variant="h3">{hit.name}</AppText>
              <AppText variant="caption">
                {Math.round(hit.kcal)} kcal · {hit.servingLabel}
              </AppText>
              <Button
                label={saving ? "Saving…" : `Add ${hit.servingLabel} to ${meal}`}
                disabled={saving}
                onPress={() => void saveHit(hit)}
              />
              <View style={{ height: space.sm }} />
              <Button label="Scan another" tone="secondary" onPress={resetScan} disabled={saving} />
            </View>
          ) : null}
          {miss ? (
            <View style={{ gap: space.sm }}>
              <AppText variant="small">No Open Food Facts product for {miss}. You can add it yourself.</AppText>
              <TextField label="Name" value={manualName} onChangeText={setManualName} />
              <TextField label="kcal" value={manualKcal} onChangeText={setManualKcal} keyboardType="numeric" />
              {error ? <AppText variant="small" color={colors.accent}>{error}</AppText> : null}
              <Button
                label={saving ? "Saving…" : `Save custom food to ${meal}`}
                disabled={saving || manualName.trim().length === 0}
                onPress={() => void saveCustom()}
              />
              <Button label="Scan another" tone="secondary" onPress={resetScan} disabled={saving} />
            </View>
          ) : null}
          {hit && error ? <AppText variant="small" color={colors.accent}>{error}</AppText> : null}
          <AppText variant="caption">{copy.disclaimer}</AppText>
        </View>
      )}
    </Screen>
  );
}
