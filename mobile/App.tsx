import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { Session } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./lib/supabase";
import { OnboardingScreen } from "./OnboardingScreen";
import { AuthScreen } from "./AuthScreen";
import { BroadcastScreen } from "./screens/BroadcastScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { TeamScreen } from "./screens/TeamScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { MyPageScreen } from "./screens/MyPageScreen";

// 下タブのアイコン（@expo/vector-icons 未導入のため絵文字で代用）
function tabIcon(emoji: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
}

// 認証/オンボーディング判定が終わるまでネイティブスプラッシュを保持（白いちらつき防止）
SplashScreen.preventAutoHideAsync().catch(() => {});

const Tab = createBottomTabNavigator();

function Tabs() {
  return (
    <Tab.Navigator
      initialRouteName="配信"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#e63946",
        tabBarInactiveTintColor: "#888",
        tabBarStyle: { backgroundColor: "#111", borderTopColor: "#222" },
      }}
    >
      <Tab.Screen name="ホーム" component={HomeScreen} options={{ tabBarIcon: tabIcon("🏠") }} />
      <Tab.Screen name="チーム" component={TeamScreen} options={{ tabBarIcon: tabIcon("👥") }} />
      <Tab.Screen name="配信" component={BroadcastScreen} options={{ tabBarIcon: tabIcon("🎥") }} />
      <Tab.Screen name="履歴" component={HistoryScreen} options={{ tabBarIcon: tabIcon("🕐") }} />
      <Tab.Screen name="マイページ" component={MyPageScreen} options={{ tabBarIcon: tabIcon("👤") }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // reject ハンドラを必ず付ける: AsyncStorage がネイティブ層で失敗(破損/容量)しても
    // onboarded を null のまま固定させない（→ スプラッシュ永久残留を防ぐ）。
    AsyncStorage.getItem("onboarded_v1").then(
      (v) => setOnboarded(v === "1"),
      () => setOnboarded(false),
    );
  }, []);

  useEffect(() => {
    // 同上: getSession が reject しても session を undefined のまま固定させない。
    supabase.auth.getSession().then(
      ({ data }) => setSession(data.session),
      () => setSession(null),
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 保険: 何らかの理由で ready にならなくても 8 秒でネイティブスプラッシュを必ず剥がす
  // （無反応スプラッシュに閉じ込めない）。
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 8000);
    return () => clearTimeout(t);
  }, []);

  const ready = onboarded !== null && session !== undefined;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  let content;
  if (onboarded === null || session === undefined) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color="#e63946" />
      </View>
    );
  } else if (!onboarded) {
    content = (
      <OnboardingScreen
        onDone={() => {
          AsyncStorage.setItem("onboarded_v1", "1").catch(() => {});
          setOnboarded(true);
        }}
      />
    );
  } else if (!session) {
    content = <AuthScreen />;
  } else {
    content = (
      <NavigationContainer>
        <Tabs />
      </NavigationContainer>
    );
  }

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
});
