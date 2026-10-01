import { useState } from "react";
import { Platform, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { deviceTimeZone, localDay } from "@vitacore/domain";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { logFood } from "@/data/logs";
import { productByBarcode, type FoodHit } from "@/nutrition/openFoodFacts";
import { copy } from "@/i18n/copy";
import { space } from "@/design/tokens";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [hit, setHit] = useState<FoodHit | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [locked, setLocked] = useState(false);

  if (Platform.OS === "web") {
    return (
      <Screen>
        <AppText variant="h1">Barcode</AppText>
        <AppText variant="body">Scanning uses the device camera in the iOS and Android app. This browser cannot scan a package.</AppText>
      </Screen>
    );
  }

  async function onScan(code: string) {
    if (locked) return;
    setLocked(true);
    setMiss(null);
    try {
      const product = await productByBarcode(code);
      if (!product) {
        setMiss(code);
        setHit(null);
      } else {
        setHit(product);
      }
    } catch (error) {
      setMiss(error instanceof Error ? error.message : "The lookup failed.");
    }
  }

  return (
    <Screen scroll={false}>
      <AppText variant="h1">Scan</AppText>
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
            onBarcodeScanned={({ data }) => void onScan(data)}
          />
          {hit ? (
            <View>
              <AppText variant="h3">{hit.name}</AppText>
              <AppText variant="caption">{Math.round(hit.kcal)} kcal per 100 g</AppText>
              <Button label="Add to lunch" onPress={() => void logFood({
                day: localDay(new Date(), deviceTimeZone()),
                timezone: deviceTimeZone(),
                meal: "lunch",
                name: hit.name,
                source: "barcode",
                sourceId: hit.id,
                servings: 1,
                kcal: hit.kcal,
                proteinG: hit.proteinG,
                carbsG: hit.carbsG,
                fatG: hit.fatG,
                fiberG: hit.fiberG,
                sugarG: hit.sugarG,
                sodiumMg: hit.sodiumMg,
              })} />
            </View>
          ) : null}
          {miss ? (
            <View style={{ gap: space.sm }}>
              <AppText variant="small">No Open Food Facts product for {miss}. You can add it yourself.</AppText>
              <TextField label="Name" value={manualName} onChangeText={setManualName} />
              <TextField label="kcal per serving" value={manualKcal} onChangeText={setManualKcal} keyboardType="numeric" />
              <Button label="Save custom food" onPress={() => void logFood({
                day: localDay(new Date(), deviceTimeZone()),
                timezone: deviceTimeZone(),
                meal: "lunch",
                name: manualName,
                source: "custom",
                sourceId: miss,
                servings: 1,
                kcal: Number(manualKcal) || 0,
                proteinG: null,
                carbsG: null,
                fatG: null,
                fiberG: null,
                sugarG: null,
                sodiumMg: null,
              })} />
            </View>
          ) : null}
          <AppText variant="caption">{copy.disclaimer}</AppText>
        </View>
      )}
    </Screen>
  );
}
