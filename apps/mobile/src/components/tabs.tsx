import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Activity, Dumbbell, House, Moon, Utensils } from "lucide-react-native";
import { AppText } from "@/components/ui";
import { useTheme } from "@/design/theme";
import { selectionHaptic } from "@/lib/haptics";
import { useAppState } from "@/data/app-state";

const items = [
  { name: "index", label: "Home", Icon: House },
  { name: "activity", label: "Activity", Icon: Activity },
  { name: "workout", label: "Workout", Icon: Dumbbell },
  { name: "sleep", label: "Sleep", Icon: Moon },
  { name: "nutrition", label: "Nutrition", Icon: Utensils },
] as const;

export function BottomNavigation({
  state,
  navigation,
}: {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { haptics } = useAppState();
  return (
    <View
      style={{
        flexDirection: "row",
        paddingBottom: Math.max(insets.bottom, 10),
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      {state.routes.map((route, index) => {
        const item = items.find((entry) => entry.name === route.name);
        if (!item) return null;
        const focused = state.index === index;
        const Icon = item.Icon;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            onPress={() => {
              void selectionHaptic(haptics);
              navigation.navigate(route.name);
            }}
            style={{ flex: 1, alignItems: "center", gap: 4, minHeight: 48 }}
          >
            <Icon color={focused ? colors.accent : colors.textMuted} size={20} strokeWidth={1.75} />
            <AppText variant="caption" color={focused ? colors.text : colors.textMuted}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
