import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Purchases, { type PurchasesPackage } from "react-native-purchases";
import { supabase } from "../lib/supabase";
import { waitForPaidPlan } from "../lib/plan";
import { RC_SUPPORTED } from "../lib/revenuecat";
import { SITE_URL } from "../config";

// 商品ID → プラン表示情報。RevenueCat の package.product.identifier で判定する
// （パッケージ名ではなく商品IDで見分けるので、RevenueCat側のパッケージ命名に依存しない）。
const TIERS: Record<string, { name: string; features: string[]; order: number }> = {
  broadcaster_monthly: {
    name: "配信者プラン",
    order: 1,
    features: ["自社プレイヤーで無制限ライブ配信", "スコアボード・共有コード", "LINE共有"],
  },
  team_monthly: {
    name: "チームプラン",
    order: 2,
    features: ["配信者プランの全機能", "YouTube 自動アーカイブ", "チーム管理・スケジュール"],
  },
};

export function PaywallScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setUserId(data.session?.user.id ?? null);
      if (!RC_SUPPORTED) {
        if (!cancelled) setError("この端末では購入に対応していません。");
        return;
      }
      try {
        const offerings = await Purchases.getOfferings();
        const pkgs = offerings.current?.availablePackages ?? [];
        const sorted = pkgs
          .filter((p) => TIERS[p.product.identifier])
          .sort(
            (a, b) => TIERS[a.product.identifier].order - TIERS[b.product.identifier].order,
          );
        if (!cancelled) setPackages(sorted);
      } catch {
        if (!cancelled) {
          setError("プラン情報の取得に失敗しました。時間をおいて再度お試しください。");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const purchase = async (pkg: PurchasesPackage) => {
    if (busy) return;
    setBusy("購入処理中…");
    try {
      await Purchases.purchasePackage(pkg);
      setBusy("反映中…");
      if (userId) await waitForPaidPlan(userId);
      setBusy(null);
      Alert.alert("ありがとうございます", "プランが有効になりました。", [
        { text: "OK", onPress: close },
      ]);
    } catch (e) {
      setBusy(null);
      const err = e as { userCancelled?: boolean; message?: string };
      if (err.userCancelled) return; // ユーザーキャンセルは無視
      Alert.alert("購入エラー", err.message ?? "購入に失敗しました。");
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy("復元中…");
    try {
      const info = await Purchases.restorePurchases();
      if (Object.keys(info.entitlements.active).length === 0) {
        setBusy(null);
        Alert.alert("購入の復元", "復元できる購入が見つかりませんでした。");
        return;
      }
      setBusy("反映中…");
      if (userId) await waitForPaidPlan(userId);
      setBusy(null);
      Alert.alert("復元完了", "プランを復元しました。", [{ text: "OK", onPress: close }]);
    } catch (e) {
      setBusy(null);
      const err = e as { message?: string };
      Alert.alert("復元エラー", err.message ?? "復元に失敗しました。");
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Pressable
        onPress={close}
        style={[styles.closeBtn, { top: insets.top + 8 }]}
        hitSlop={16}
      >
        <Text style={styles.closeTxt}>×</Text>
      </Pressable>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.title}>プランを選ぶ</Text>
        <Text style={styles.subtitle}>LIVE SPOtCH のプランにアップグレード</Text>

        {error && <Text style={styles.error}>{error}</Text>}
        {!error && packages === null && (
          <ActivityIndicator color="#e63946" style={{ marginTop: 48 }} />
        )}
        {!error && packages?.length === 0 && (
          <Text style={styles.error}>
            現在プランを取得できません。少し時間をおいて再度お試しください。
          </Text>
        )}

        {packages?.map((pkg) => {
          const tier = TIERS[pkg.product.identifier];
          return (
            <View key={pkg.identifier} style={styles.card}>
              <Text style={styles.planName}>{tier.name}</Text>
              <Text style={styles.price}>
                {pkg.product.priceString}
                <Text style={styles.priceUnit}> / 月</Text>
              </Text>
              {tier.features.map((f) => (
                <Text key={f} style={styles.feature}>
                  ・{f}
                </Text>
              ))}
              <Pressable
                style={[styles.buyBtn, busy ? styles.btnDisabled : null]}
                onPress={() => purchase(pkg)}
                disabled={!!busy}
              >
                <Text style={styles.buyTxt}>このプランを購入</Text>
              </Pressable>
            </View>
          );
        })}

        <Pressable onPress={restore} disabled={!!busy} style={styles.restoreBtn}>
          <Text style={styles.restoreTxt}>購入を復元</Text>
        </Pressable>

        <Text style={styles.note}>
          月額の自動更新サブスクリプションです。期間終了の24時間前までに解約しない限り自動更新され、
          Apple ID に課金されます。解約は iOS の「設定 &gt; Apple ID &gt; サブスクリプション」から行えます。
        </Text>
        <View style={styles.links}>
          <Text style={styles.link} onPress={() => Linking.openURL(`${SITE_URL}/terms`)}>
            利用規約
          </Text>
          <Text style={styles.linkSep}>/</Text>
          <Text style={styles.link} onPress={() => Linking.openURL(`${SITE_URL}/privacy`)}>
            プライバシーポリシー
          </Text>
        </View>
      </ScrollView>

      {busy && (
        <View style={styles.overlay} pointerEvents="auto">
          <ActivityIndicator color="#fff" />
          <Text style={styles.overlayTxt}>{busy}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  closeBtn: { position: "absolute", right: 12, zIndex: 10, padding: 10 },
  closeTxt: { color: "#fff", fontSize: 30, lineHeight: 30 },
  scroll: { paddingHorizontal: 20, paddingTop: 36 },
  title: { color: "#fff", fontSize: 26, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "#aaa", fontSize: 14, textAlign: "center", marginTop: 6, marginBottom: 20 },
  error: { color: "#ffb4b4", fontSize: 14, textAlign: "center", marginTop: 32, lineHeight: 22 },
  card: {
    backgroundColor: "#16181c",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2d33",
    padding: 18,
    marginBottom: 16,
  },
  planName: { color: "#fff", fontSize: 20, fontWeight: "800" },
  price: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4, marginBottom: 12 },
  priceUnit: { color: "#aaa", fontSize: 15, fontWeight: "600" },
  feature: { color: "#ddd", fontSize: 14, lineHeight: 24 },
  buyBtn: {
    backgroundColor: "#e63946",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.5 },
  buyTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  restoreBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  restoreTxt: { color: "#7aa2ff", fontSize: 14, fontWeight: "600" },
  note: { color: "#777", fontSize: 11, lineHeight: 18, marginTop: 16 },
  links: { flexDirection: "row", justifyContent: "center", marginTop: 12, gap: 8 },
  link: { color: "#7aa2ff", fontSize: 12 },
  linkSep: { color: "#555", fontSize: 12 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  overlayTxt: { color: "#fff", fontSize: 14 },
});
