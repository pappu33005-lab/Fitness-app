import { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText, Button, LoadingState, Screen } from "@/components/ui";
import { draftToValues, FoodEntryForm, type FoodEntryDraft } from "@/components/food-entry-form";
import { deleteFoodLog, foodLogById, updateFoodLog, type MealName } from "@/data/logs";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

/** Edits an existing entry's stored totals (name, meal, macros, notes). Servings are not editable here — see updateFoodLog. */
export default function EditFoodScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [state, setState] = useState<"loading" | "missing" | "ready">(id ? "loading" : "missing");
  const [draft, setDraft] = useState<FoodEntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void foodLogById(id).then((row) => {
      if (cancelled) return;
      if (!row) {
        setState("missing");
        return;
      }
      setDraft({
        meal: row.meal as MealName,
        name: row.food_name,
        kcal: String(Math.round(row.kcal)),
        proteinG: row.protein_g == null ? "" : String(row.protein_g),
        carbsG: row.carbs_g == null ? "" : String(row.carbs_g),
        fatG: row.fat_g == null ? "" : String(row.fat_g),
        fiberG: row.fiber_g == null ? "" : String(row.fiber_g),
        notes: row.notes ?? "",
      });
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submit() {
    if (!id || !draft) return;
    const values = draftToValues(draft);
    if (!values) {
      setError("Enter a food name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateFoodLog(id, {
        meal: values.meal,
        name: values.name,
        kcal: values.kcal,
        proteinG: values.proteinG,
        carbsG: values.carbsG,
        fatG: values.fatG,
        fiberG: values.fiberG,
        sugarG: null,
        sodiumMg: null,
        notes: values.notes,
      });
      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This entry could not be saved.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    await deleteFoodLog(id);
    router.back();
  }

  if (state === "loading") return <Screen><LoadingState label="Opening this entry…" /></Screen>;
  if (state === "missing" || !draft) {
    return (
      <Screen>
        <AppText variant="small" color={colors.textSecondary}>This food entry is not on this device.</AppText>
        <View style={{ height: space.md }} />
        <Button label="Back" tone="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FoodEntryForm draft={draft} onChange={setDraft} submitLabel="Save changes" onSubmit={() => void submit()} busy={busy} error={error} />
      <View style={{ height: space.lg }} />
      <Button label="Delete entry" tone="danger" onPress={() => void remove()} disabled={busy} />
    </Screen>
  );
}
