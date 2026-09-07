import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
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
import { fetchPlan, waitForPaidPlan } from "../lib/plan";
import { RC_SUPPORTED, ensureRcIdentity } from "../lib/revenuecat";
import { SITE_URL } from "../config";

// 商品ID → プラン表示情報。RevenueCat の package.product.identifier で判定する
// （パッケージ名ではなく商品IDで見分けるので、RevenueCat側のパッケージ命名に依存しない）。
const TIERS: Record<string, { name: string; features: string[]; order: number; plan: "broadcaster" | "team" }> = {
  broadcaster_monthly: {
    name: "配信者プラン",
    order: 1,
    plan: "broadcaster",
    features: ["自社プレイヤーで無制限ライブ配信", "スコアボード・共有コード", "LINE共有"],
  },
  team_monthly: {
    name: "チームプラン",
    order: 2,
    plan: "team",
    features: ["配信者プランの全機能", "YouTube 自動アーカイブ", "チーム管理・スケジュール"],
  },
};

// RevenueCat の product.identifier は、Google Play では "{subscriptionId}:{basePlanId}"
// （例 "broadcaster_monthly:monthly"）の形式になる。iOS は ":" を含まないのでそのまま。
// TIERS のキー（サブスクID）と突き合わせるため、":" より前の基本商品IDに正規化する。
const tierKey = (identifier: string) => identifier.split(":")[0];

export function PaywallScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ★ 2026-08-04: 契約中かどうかを一切見ずに「このプランを購入」を出していたため、
  //   Web(Stripe)で契約済みの人がアプリを入れてここを開くと**そのまま二重課金できてしまう**
  //   （実際に1件発生）。現在の契約状況を取得して、購入導線を出し分ける。
  const [currentPlan, setCurrentPlan] = useState<"free" | "broadcaster" | "team" | null>(null);
  const [billedViaStripe, setBilledViaStripe] = useState(false);
  const [billedViaIap, setBilledViaIap] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id ?? null;
      if (!cancelled) setUserId(uid);
      // 現在の契約状況（プラン／課金元）を取得する。取れなかった場合は購入を止めない
      // （安全側＝買えなくなるより二重課金の警告が出ない方がまし、という判断ではなく、
      //   取得失敗で購入不能にすると正当な新規購入まで塞ぐため）。
      // 🔴 profiles の stripe_subscription_id / iap_product_id は **service_role 専用**で、
      //    クライアント(authenticated)には列レベル GRANT されていない。
      //    PostgREST は1列でも権限が無いとクエリ**全体**を 42501 で落とすため、それらを
      //    混ぜて select すると plan まで取れず prof=null になり、下の出し分けが全て
      //    素通りして「このプランを購入」に落ちる＝二重課金ガードが 100% 不発になる。
      //    （本番へ実際にリクエストして確認: select=plan 単独でも 42501、
      //      select=display_name は 200。許可列だけを指定すること）
      //    → GRANT 済みの plan は fetchPlan で、課金元は RevenueCat から判定する。
      if (uid) {
        const plan = await fetchPlan(uid);
        if (!cancelled) setCurrentPlan(plan);
        // 課金元の判定は有料プランのときだけ行う（無料ユーザーに余計な通信をしない）。
        if (plan !== "free" && RC_SUPPORTED) {
          try {
            // ★ getCustomerInfo は「いま RevenueCat にログインしている人」を返す。
            //    ensureRcIdentity を先に通さないと匿名ユーザーの情報を見てしまい、
            //    IAP 課金者を「Webで契約中」と誤判定する（購入時 :133 と同じ手順）。
            const identityOk = await ensureRcIdentity(uid);
            const info = await Purchases.getCustomerInfo();
            const hasIap = Object.keys(info.entitlements.active).length > 0;
            // 本人として照合できたときだけ信用する。照合できなければ両方 false のまま
            //  ＝「ご利用中のプラン」の出し分けだけが効く安全な状態に留める。
            if (!cancelled && identityOk) {
              setBilledViaIap(hasIap);
              // 有料プランなのに RevenueCat に購読が無い ＝ Web(Stripe) 経由。
              setBilledViaStripe(!hasIap);
            }
          } catch {
            /* 課金元が判定できなくても購入は塞がない（正当な新規購入を守る） */
          }
        }
      }
      if (!RC_SUPPORTED) {
        if (!cancelled) setError("この端末では購入に対応していません。");
        return;
      }
      try {
        const offerings = await Purchases.getOfferings();
        const pkgs = offerings.current?.availablePackages ?? [];
        const sorted = pkgs
          .filter((p) => TIERS[tierKey(p.product.identifier)])
          .sort(
            (a, b) =>
              TIERS[tierKey(a.product.identifier)].order -
              TIERS[tierKey(b.product.identifier)].order,
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
    if (!userId) {
      Alert.alert(
        "購入を開始できません",
        "ログイン情報を確認できませんでした。アプリを再起動してから、もう一度お試しください。",
      );
      return;
    }
    // 購入前に必ず RevenueCat を実 user.id でログイン状態にする。ここで匿名（$RCAnonymousID）を
    // 排除しないと、購入が匿名IDに紐づき webhook がプランを反映できない（起動時 logIn 取りこぼし対策）。
    setBusy("購入準備中…");
    const identityOk = await ensureRcIdentity(userId);
    if (!identityOk) {
      setBusy(null);
      Alert.alert(
        "購入を開始できません",
        "アカウントの確認に失敗しました。通信環境をご確認のうえ、アプリを再起動してから、もう一度お試しください。",
      );
      return;
    }
    setBusy("購入処理中…");
    try {
      await Purchases.purchasePackage(pkg);
      setBusy("反映中…");
      const plan = await waitForPaidPlan(userId);
      setBusy(null);
      if (plan === "free") {
        // 決済は完了したが webhook 反映待ち（混雑・Android の遅延決済・承認待ち購入など）。
        // 未反映なのに「有効になりました」と言わない＝「課金したのに反映されない」の再発防止。
        Alert.alert(
          "ご購入を受け付けました",
          "プランの反映まで数分かかる場合があります。自動で有効になりますので、そのままお待ちください。",
          [{ text: "OK", onPress: close }],
        );
      } else {
        Alert.alert("ありがとうございます", "プランが有効になりました。", [
          { text: "OK", onPress: close },
        ]);
      }
    } catch (e) {
      setBusy(null);
      const err = e as { userCancelled?: boolean; message?: string };
      if (err.userCancelled) return; // ユーザーキャンセルは無視
      Alert.alert("購入エラー", err.message ?? "購入に失敗しました。");
    }
  };

  const restore = async () => {
    if (busy) return;
    if (!userId) {
      Alert.alert(
        "復元できません",
        "ログイン情報を確認できませんでした。アプリを再起動してから、もう一度お試しください。",
      );
      return;
    }
    // 復元も同じく実 user.id でログイン状態を保証してから行う（匿名に復元が紐づくのを防ぐ）。
    setBusy("確認中…");
    const identityOk = await ensureRcIdentity(userId);
    if (!identityOk) {
      setBusy(null);
      Alert.alert(
        "復元できません",
        "アカウントの確認に失敗しました。通信環境をご確認のうえ、アプリを再起動してから、もう一度お試しください。",
      );
      return;
    }
    setBusy("復元中…");
    try {
      const info = await Purchases.restorePurchases();
      if (Object.keys(info.entitlements.active).length === 0) {
        setBusy(null);
        Alert.alert("購入の復元", "復元できる購入が見つかりませんでした。");
        return;
      }
      setBusy("反映中…");
      const plan = await waitForPaidPlan(userId);
      setBusy(null);
      if (plan === "free") {
        Alert.alert(
          "購入を復元しました",
          "プランの反映まで数分かかる場合があります。自動で有効になりますので、そのままお待ちください。",
          [{ text: "OK", onPress: close }],
        );
      } else {
        Alert.alert("復元完了", "プランを復元しました。", [{ text: "OK", onPress: close }]);
      }
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
          const tier = TIERS[tierKey(pkg.product.identifier)];
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
              {tier.plan === currentPlan ? (
                // 契約中のプランは購入させない（同じものを二重に買えてしまうため）
                <View style={[styles.buyBtn, styles.currentBtn]}>
                  <Text style={styles.currentTxt}>ご利用中のプラン</Text>
                </View>
              ) : billedViaStripe ? (
                // Web(Stripe)で課金中の人がここで買うと**二重課金**になる（実例あり）。
                // アプリからの購入は塞ぎ、Web側での変更に誘導する。
                <Pressable
                  style={[styles.buyBtn, styles.btnDisabled]}
                  onPress={() =>
                    Alert.alert(
                      "Webサイトでご契約中です",
                      "このままアプリで購入すると、Webとアプリの両方で毎月お支払いが発生します。プランの変更・解約は、ご契約中のWebサイト（マイページ）から行ってください。",
                    )
                  }
                >
                  <Text style={styles.buyTxt}>Webでご契約中（購入できません）</Text>
                </Pressable>
              ) : billedViaIap && Platform.OS === "android" ? (
                // Android のプラン変更をアプリ内購入で行うと、旧プランが残ったまま新プランが
                // 増える恐れがある。Google Play の定期購入画面での変更に誘導する（安全側）。
                <Pressable
                  style={styles.buyBtn}
                  onPress={() =>
                    Linking.openURL(
                      "https://play.google.com/store/account/subscriptions",
                    ).catch(() => {})
                  }
                >
                  <Text style={styles.buyTxt}>Google Play でプランを変更</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.buyBtn, busy ? styles.btnDisabled : null]}
                  onPress={() => purchase(pkg)}
                  disabled={!!busy}
                >
                  <Text style={styles.buyTxt}>このプランを購入</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Pressable onPress={restore} disabled={!!busy} style={styles.restoreBtn}>
          <Text style={styles.restoreTxt}>購入を復元</Text>
        </Pressable>

        <Text style={styles.note}>
          月額の自動更新サブスクリプションです。期間終了の24時間前までに解約しない限り自動更新されます。
          {Platform.OS === "android"
            ? "お支払いは Google アカウントに課金され、解約は Google Play ストアの「お支払いと定期購入 > 定期購入」から行えます。"
            : "お支払いは Apple ID に課金され、解約は iOS の「設定 > Apple ID > サブスクリプション」から行えます。"}
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
  currentBtn: { backgroundColor: "rgba(255,255,255,0.12)" },
  currentTxt: {
    color: "#4ade80",
    fontWeight: "800",
    fontSize: 15,
    textAlign: "center",
  },
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
