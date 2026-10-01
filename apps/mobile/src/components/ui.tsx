import { useEffect, useRef, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, radius, space, type AppColors } from "@/design/tokens";
import { useTheme } from "@/design/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Tone = "primary" | "secondary" | "ghost" | "danger";

export function AppText({
  children,
  variant = "body",
  color,
  style,
}: {
  children: ReactNode;
  variant?: "display" | "h1" | "h2" | "h3" | "body" | "small" | "caption" | "label" | "metric";
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        stylesFor(variant, colors),
        { color: color ?? (variant === "label" || variant === "caption" ? colors.textSecondary : colors.text) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

function stylesFor(variant: string, colors: AppColors): TextStyle {
  const base: TextStyle = { fontFamily: font.regular, color: colors.text };
  switch (variant) {
    case "display":
      return { ...base, fontFamily: font.medium, fontSize: 40, lineHeight: 44, letterSpacing: -1.2 };
    case "metric":
      return { ...base, fontFamily: font.medium, fontSize: 52, lineHeight: 56, letterSpacing: -1.6, fontVariant: ["tabular-nums"] };
    case "h1":
      return { ...base, fontFamily: font.medium, fontSize: 32, lineHeight: 36, letterSpacing: -0.8 };
    case "h2":
      return { ...base, fontFamily: font.medium, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 };
    case "h3":
      return { ...base, fontFamily: font.medium, fontSize: 17, lineHeight: 22 };
    case "small":
      return { ...base, fontSize: 14, lineHeight: 20 };
    case "caption":
      return { ...base, fontSize: 12, lineHeight: 16 };
    case "label":
      return { ...base, fontFamily: font.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: "uppercase" };
    default:
      return { ...base, fontSize: 16, lineHeight: 22 };
  }
}

export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: insets.top + space.sm, paddingBottom: space.xxxl }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: insets.top + space.sm }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {content}
      {footer}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const background =
    tone === "primary" ? colors.accent : tone === "danger" ? colors.danger : "transparent";
  const textColor = tone === "primary" ? colors.onAccent : tone === "danger" ? "#fff" : colors.text;
  const borderColor = tone === "secondary" ? colors.border : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.pill,
        paddingHorizontal: space.lg,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
        borderWidth: tone === "secondary" ? 1 : 0,
        borderColor,
        opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
      })}
    >
      <AppText variant="small" color={textColor} style={{ fontFamily: font.medium }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

export function Badge({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: colors.accentMuted, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      <AppText variant="caption" color={colors.accent} style={{ fontFamily: font.medium }}>
        {label}
      </AppText>
    </View>
  );
}

export function ProgressBar({ progress }: { progress: number | null }) {
  const { colors } = useTheme();
  const width = progress == null ? 0 : Math.max(0, Math.min(1, progress));
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.track, overflow: "hidden" }}>
      <View style={{ width: `${width * 100}%`, height: "100%", backgroundColor: colors.accent }} />
    </View>
  );
}

export function ProgressRing({
  progress,
  label,
  caption,
  size = 112,
}: {
  progress: number | null;
  label: string;
  caption: string;
  size?: number;
}) {
  const { colors } = useTheme();
  const stroke = 8;
  const radiusPx = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const target = progress == null ? 0 : Math.max(0, Math.min(1, progress));
  const animated = useSharedValue(0);
  const reduced = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      reduced.current = value;
      animated.value = value ? target : withTiming(target, { duration: 700 });
    });
  }, [animated, target]);

  const props = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animated.value),
  }));

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`${caption} ${label}`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radiusPx} stroke={colors.track} strokeWidth={stroke} fill="none" />
        {progress != null ? (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radiusPx}
            stroke={colors.accent}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={props}
            strokeLinecap="round"
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        ) : null}
      </Svg>
      <View style={{ position: "absolute", alignItems: "center" }}>
        <AppText variant="h3">{label}</AppText>
        <AppText variant="caption">{caption}</AppText>
      </View>
    </View>
  );
}

export function LineChart({ points, height = 120 }: { points: number[]; height?: number }) {
  const { colors } = useTheme();
  if (points.length < 2) {
    return <EmptyState title="No chart yet" body="A line appears after there are at least two real points." />;
  }
  const width = 320;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - min) / span) * (height - 8) - 4;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path d={d} stroke={colors.chart[1]} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export function BarChart({ values }: { values: { label: string; value: number }[] }) {
  const { colors } = useTheme();
  if (values.length === 0) return <EmptyState title="Nothing to compare" body="Bars use recorded values only." />;
  const max = Math.max(...values.map((item) => item.value), 1);
  return (
    <View style={{ gap: space.sm }}>
      {values.map((item) => (
        <View key={item.label} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <AppText variant="caption">{item.label}</AppText>
            <AppText variant="caption" color={colors.text}>{item.value}</AppText>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.track }}>
            <View style={{ width: `${(item.value / max) * 100}%`, height: "100%", borderRadius: 4, backgroundColor: colors.chart[0] }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function WeekStrip({
  days,
  onSelect,
}: {
  days: { key: string; label: string; selected: boolean }[];
  onSelect: (key: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {days.map((day) => (
        <Pressable
          key={day.key}
          accessibilityRole="button"
          accessibilityLabel={day.key}
          accessibilityState={{ selected: day.selected }}
          onPress={() => onSelect(day.key)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: day.selected ? colors.accent : colors.track,
          }}
        >
          <AppText variant="caption" color={day.selected ? colors.accent : colors.textMuted} style={{ fontFamily: font.medium }}>
            {day.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? colors.elevated : "transparent",
            }}
          >
            <AppText variant="caption" color={selected ? colors.text : colors.textMuted} style={{ fontFamily: font.medium }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      accessibilityLabel={placeholder}
      style={{
        minHeight: 48,
        borderRadius: radius.pill,
        paddingHorizontal: space.lg,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        color: colors.text,
        fontFamily: font.regular,
        fontSize: 16,
      }}
    />
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "email-address" | "numeric" | "decimal-pad" | "numbers-and-punctuation";
  placeholder?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        accessibilityLabel={label}
        style={{
          minHeight: 52,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          backgroundColor: colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          color: colors.text,
          fontFamily: font.regular,
          fontSize: 16,
        }}
      />
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}
    >
      <AppText variant="body">{label}</AppText>
      <View style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: value ? colors.accent : colors.track, justifyContent: "center", padding: 3 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background, alignSelf: value ? "flex-end" : "flex-start" }} />
      </View>
    </Pressable>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <AppText variant="body">{label}</AppText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Button label="−" tone="secondary" onPress={() => onChange(value - step)} />
        <AppText variant="h3">
          {value}
          {suffix ? ` ${suffix}` : ""}
        </AppText>
        <Button label="+" tone="secondary" onPress={() => onChange(value + step)} />
      </View>
    </View>
  );
}

export function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label">{label}</AppText>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {steps.map((step) => (
          <Pressable
            key={step}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${Math.round(step * 100)} percent`}
            onPress={() => onChange(step)}
            style={{
              flex: 1,
              height: 36,
              borderRadius: radius.pill,
              backgroundColor: value === step ? colors.accent : colors.track,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: space.lg, gap: 6 }}>
      <AppText variant="h3">{title}</AppText>
      <AppText variant="small" color={colors.textSecondary}>{body}</AppText>
    </View>
  );
}

export function ErrorState({ title, body, action }: { title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <Card>
      <View style={{ gap: space.md }}>
        <AppText variant="h3">{title}</AppText>
        <AppText variant="small">{body}</AppText>
        {action ? <Button label={action.label} onPress={action.onPress} /> : null}
      </View>
    </Card>
  );
}

export function LoadingState({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: space.xxl, alignItems: "center", gap: space.md }}>
      <ActivityIndicator color={colors.accent} />
      <AppText variant="small">{label}</AppText>
    </View>
  );
}

export function Skeleton({ height = 18 }: { height?: number }) {
  const { colors } = useTheme();
  return <View style={{ height, borderRadius: radius.sm, backgroundColor: colors.track }} />;
}

export function StatRow({
  label,
  value,
  detail,
  onPress,
}: {
  label: string;
  value: string;
  detail?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const body = (
    <View style={{ paddingVertical: 12, gap: 2 }}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="h2">{value}</AppText>
      {detail ? <AppText variant="caption">{detail}</AppText> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
      {body}
    </Pressable>
  );
}

export function ChoiceList<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; detail?: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              padding: space.lg,
              borderRadius: radius.md,
              backgroundColor: selected ? colors.accentMuted : colors.surface,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.border,
              gap: 4,
            }}
          >
            <AppText variant="h3">{option.label}</AppText>
            {option.detail ? <AppText variant="small" color={colors.textSecondary}>{option.detail}</AppText> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Dialog({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: space.xl }}>
        <View style={{ backgroundColor: colors.elevated, borderRadius: radius.lg, padding: space.xl, gap: space.lg }}>
          <AppText variant="h2">{title}</AppText>
          <AppText variant="small" color={colors.textSecondary}>{body}</AppText>
          <Button label={confirmLabel} tone="danger" onPress={onConfirm} />
          <Button label="Cancel" tone="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.elevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.xl, gap: space.md }}>
        {children}
      </View>
    </Modal>
  );
}

export function CalendarMonth({
  month,
  selected,
  onSelect,
}: {
  month: Date;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const { colors } = useTheme();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {cells.map((day, index) => {
        const key = day ? `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : `pad-${index}`;
        const isSelected = key === selected;
        return (
          <Pressable
            key={key}
            disabled={!day}
            onPress={() => day && onSelect(key)}
            style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" }}
          >
            {day ? (
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? colors.accent : "transparent" }}>
                <AppText variant="caption" color={isSelected ? colors.onAccent : colors.text}>{day}</AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <TextField label={label} value={value} onChangeText={onChange} placeholder="22:30" keyboardType="numbers-and-punctuation" />;
}

export function Avatar({ label }: { label: string }) {
  const { colors } = useTheme();
  const letter = label.trim().charAt(0).toUpperCase() || "•";
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentMuted, alignItems: "center", justifyContent: "center" }}>
      <AppText variant="small" color={colors.accent} style={{ fontFamily: font.semibold }}>{letter}</AppText>
    </View>
  );
}

export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(selected ? null : option)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.border,
              backgroundColor: selected ? colors.accentMuted : "transparent",
            }}
          >
            <AppText variant="caption" color={selected ? colors.accent : colors.textSecondary}>{option}</AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function AreaChart({ points }: { points: number[] }) {
  const { colors } = useTheme();
  if (points.length < 2) return <LineChart points={points} />;
  const width = 320;
  const height = 120;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const line = points
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - min) / span) * (height - 8) - 4;
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path d={`M${line} L${width} ${height} L0 ${height} Z`} fill={colors.accentMuted} />
      <Path d={`M${line}`} stroke={colors.accent} strokeWidth={2} fill="none" />
      <Rect x={0} y={0} width={0} height={0} />
    </Svg>
  );
}
