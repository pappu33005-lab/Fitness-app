import { useEffect, useState } from "react";
import { View } from "react-native";
import { AppText, Button, Screen, TextField } from "@/components/ui";
import { getSupabase, supabaseConfigStatus } from "@/auth/supabase";
import { copy } from "@/i18n/copy";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

export default function AccountScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const configured = supabaseConfigStatus() === "ready";

  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    let cancelled = false;
    void client.auth.getSession().then(({ data }) => {
      if (!cancelled) setSessionEmail(data.session?.user.email ?? null);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  async function act(kind: "sign-up" | "sign-in" | "reset") {
    const client = getSupabase();
    if (!client) {
      setMessage("Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. The service role key does not belong in the app.");
      return;
    }
    if (kind === "reset") {
      const { error } = await client.auth.resetPasswordForEmail(email);
      setMessage(error ? error.message : "If the address is registered, a reset message is on its way.");
      return;
    }
    const method = kind === "sign-up" ? client.auth.signUp({ email, password }) : client.auth.signInWithPassword({ email, password });
    const { error } = await method;
    setMessage(error ? error.message : kind === "sign-up" ? "Account created. Confirm the email if the project requires it, then your local history can be uploaded." : "Signed in.");
  }

  async function signOut() {
    const client = getSupabase();
    if (!client) {
      setMessage("Cloud sign-in is waiting on the Supabase environment variables.");
      return;
    }
    const { error } = await client.auth.signOut();
    setPassword("");
    setMessage(error ? error.message : "Signed out. Local data on this device is unchanged.");
  }

  return (
    <Screen>
      <AppText variant="h1">Account</AppText>
      <AppText variant="small" color={colors.textSecondary}>{copy.guestCloud}</AppText>
      <View style={{ height: space.lg }} />
      {!configured ? <AppText variant="small">Cloud sign-in is waiting on the Supabase environment variables.</AppText> : null}
      {sessionEmail ? (
        <>
          <AppText variant="small">Signed in as {sessionEmail}</AppText>
          <View style={{ height: space.sm }} />
          <Button label="Sign out" tone="secondary" onPress={() => void signOut()} />
          <View style={{ height: space.lg }} />
        </>
      ) : null}
      <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <View style={{ height: space.sm }} />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <View style={{ height: space.md }} />
      <Button label="Create account" onPress={() => void act("sign-up")} />
      <View style={{ height: space.sm }} />
      <Button label="Sign in" tone="secondary" onPress={() => void act("sign-in")} />
      <View style={{ height: space.sm }} />
      <Button label="Email a reset link" tone="ghost" onPress={() => void act("reset")} />
      <View style={{ height: space.md }} />
      <AppText variant="caption">Apple and Google sign-in need those providers enabled in Supabase and the native client ids. They are not wired until those exist, so this screen does not pretend a social login succeeded.</AppText>
      {message ? <AppText variant="small">{message}</AppText> : null}
    </Screen>
  );
}
