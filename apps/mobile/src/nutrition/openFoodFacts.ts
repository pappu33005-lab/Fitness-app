import { brandConfig } from "@vitacore/brand";
import { openFoodFactsServingLabel, resolveServingQuantityGrams } from "@vitacore/domain";

export type FoodHit = {
  id: string;
  name: string;
  brand: string | null;
  servingLabel: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  source: "open_food_facts";
};

type Nutriments = Record<string, number | string | undefined>;

function numberOrNull(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function fromNutriments(
  nutriments: Nutriments,
  name: string,
  brand: string | null,
  id: string,
  servingQuantity: number | string | null | undefined,
  servingQuantityUnit: string | null | undefined,
): FoodHit | null {
  const kcal = numberOrNull(nutriments["energy-kcal_100g"]);
  const protein = numberOrNull(nutriments.proteins_100g);
  const carbs = numberOrNull(nutriments.carbohydrates_100g);
  const fat = numberOrNull(nutriments.fat_100g);
  if (kcal == null || protein == null || carbs == null || fat == null || !name) return null;
  const sodiumG = numberOrNull(nutriments.sodium_100g) ?? (() => {
    const saltG = numberOrNull(nutriments.salt_100g);
    return saltG == null ? null : saltG / 2.5;
  })();
  // Only scale to a declared gram serving. Never treat serving/ml/oz/unknown as grams.
  const servingQuantityG = resolveServingQuantityGrams(servingQuantity, servingQuantityUnit);
  const useServing = servingQuantityG != null;
  const scale = useServing ? servingQuantityG / 100 : 1;
  const servingLabel = openFoodFactsServingLabel(servingQuantityG);
  return {
    id,
    name,
    brand,
    servingLabel,
    kcal: kcal * scale,
    proteinG: protein * scale,
    carbsG: carbs * scale,
    fatG: fat * scale,
    fiberG: (() => {
      const fiber = numberOrNull(nutriments.fiber_100g);
      return fiber == null ? null : fiber * scale;
    })(),
    sugarG: (() => {
      const sugar = numberOrNull(nutriments.sugars_100g);
      return sugar == null ? null : sugar * scale;
    })(),
    sodiumMg: sodiumG == null ? null : Math.round(sodiumG * 1000 * scale),
    source: "open_food_facts",
  };
}

const OFF_PRODUCT_FIELDS =
  "code,product_name,brands,nutriments,serving_quantity,serving_quantity_unit,serving_size";

export async function searchOpenFoodFacts(query: string): Promise<FoodHit[]> {
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "20");
  url.searchParams.set("fields", OFF_PRODUCT_FIELDS);
  const response = await fetch(url, {
    headers: { "User-Agent": brandConfig.openFoodFactsUserAgent },
  });
  if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}.`);
  const body = (await response.json()) as {
    products?: {
      code?: string;
      product_name?: string;
      brands?: string;
      nutriments?: Nutriments;
      serving_quantity?: number | string;
      serving_quantity_unit?: string;
      serving_size?: string;
    }[];
  };
  return (body.products ?? [])
    .map((product) =>
      fromNutriments(
        product.nutriments ?? {},
        product.product_name ?? "",
        product.brands ?? null,
        product.code ?? product.product_name ?? "",
        product.serving_quantity,
        product.serving_quantity_unit,
      ),
    )
    .filter((hit): hit is FoodHit => hit != null);
}

export async function productByBarcode(code: string): Promise<FoodHit | null> {
  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${encodeURIComponent(OFF_PRODUCT_FIELDS)}`,
    {
      headers: { "User-Agent": brandConfig.openFoodFactsUserAgent },
    },
  );
  if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}.`);
  const body = (await response.json()) as {
    status?: number;
    product?: {
      code?: string;
      product_name?: string;
      brands?: string;
      nutriments?: Nutriments;
      serving_quantity?: number | string;
      serving_quantity_unit?: string;
      serving_size?: string;
    };
  };
  if (body.status !== 1 || !body.product) return null;
  return fromNutriments(
    body.product.nutriments ?? {},
    body.product.product_name ?? "",
    body.product.brands ?? null,
    body.product.code ?? code,
    body.product.serving_quantity,
    body.product.serving_quantity_unit,
  );
}
