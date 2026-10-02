import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deviceTimeZone, localDay } from "@vitacore/domain";
import { Screen } from "@/components/ui";
import { blankFoodEntryDraft, draftToValues, FoodEntryForm, type FoodEntryDraft } from "@/components/food-entry-form";
import { logFood, type MealName } from "@/data/logs";

function isMealName(value: string | string[] | undefined): value is MealName {
  const meal = Array.isArray(value) ? value[0] : value;
  return meal === "breakfast" || meal === "lunch" || meal === "dinner" || meal === "snack";
}

/** Manual entry for a food with no Open Food Facts match — homemade meals, restaurant items, anything typed by hand. */
export default function NewFoodScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string; meal?: string }>();
  const day = params.day ?? undefined;
  const [draft, setDraft] = useState<FoodEntryDraft>(blankFoodEntryDraft(isMealName(params.meal) ? params.meal : "lunch"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const values = draftToValues(draft);
    if (!values) {
      setError("Enter a food name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logFood({
        day: day ?? localDay(new Date(), deviceTimeZone()),
        timezone: deviceTimeZone(),
        meal: values.meal,
        name: values.name,
        source: "manual",
        sourceId: null,
        servings: 1,
        kcal: values.kcal,
        proteinG: values.proteinG,
        carbsG: values.carbsG,
        fatG: values.fatG,
        fiberG: values.fiberG,
        sugarG: values.sugarG,
        sodiumMg: values.sodiumMg,
        notes: values.notes,
      });
      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This food could not be saved.");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <FoodEntryForm draft={draft} onChange={setDraft} submitLabel="Add food" onSubmit={() => void submit()} busy={busy} error={error} />
    </Screen>
  );
}
