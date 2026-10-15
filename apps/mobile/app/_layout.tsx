import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "../components/ui";
import { SessionProvider } from "../lib/session";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{
          headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.ink, fontWeight: "700" }, contentStyle: { backgroundColor: colors.bg },
        }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="signin" options={{ title: "Sign in", headerBackVisible: false }} />
          <Stack.Screen name="activate" options={{ title: "Activate account" }} />
          <Stack.Screen name="home" options={{ title: "Startup Jathara", headerBackVisible: false }} />
          <Stack.Screen name="register" options={{ title: "Register a startup" }} />
          <Stack.Screen name="status" options={{ title: "Application status" }} />
          <Stack.Screen name="notifications" options={{ title: "Messages" }} />
          <Stack.Screen name="jury/index" options={{ title: "Jury" }} />
          <Stack.Screen name="jury/[startupId]" options={{ title: "Startup" }} />
          <Stack.Screen name="volunteer" options={{ title: "Volunteer" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
