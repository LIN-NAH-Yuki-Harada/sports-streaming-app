import {
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SITE_URL } from "./config";

// 初回起動時の説明画面。
// ・カメラ/マイク権限の事前説明（審査で利用目的が明確になる＋許可率が上がる）
// ・発熱対策のコツ（ケースを外す・充電しない）
// ・子どもの安全（時々ベンチ/観客席も映す＝配信プラットフォームの方針）
// ・規約/プライバシーへの導線＋同意（App Store 審査要件）
// 一度「同意して始める」を押すと AsyncStorage に記録し、次回からは出さない（App 側で制御）。
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>LIVE SPOtCH 配信へようこそ</Text>
        <Text style={styles.lead}>
          スマホ1台で、子どもの試合をTV中継のように配信できます。{"\n"}始める前に、3つだけご確認ください。
        </Text>

        <Section
          emoji="🎥"
          title="カメラ・マイクを使います"
          body="試合の映像と音声を配信するために、カメラとマイクの使用を許可してください。"
        />
        <Section
          emoji="🔥"
          title="発熱を防ぐコツ"
          body="ケースを外し、充電せずに配信してください。ネイティブ配信なので、長時間でも端末は冷たく保てます。"
        />
        <Section
          emoji="🛡️"
          title="子どもの安全のために"
          body="お子さんだけが長く映り続けないよう、ときどきベンチや観客席も映してください（配信プラットフォームの方針です）。"
        />
        <Section
          emoji="🚫"
          title="不適切なコンテンツは一切許容しません"
          body="嫌がらせ・わいせつ・暴力など不適切なコンテンツや迷惑行為は禁止です。見かけた配信は各画面の「⋯」から通報・ブロックでき、通報には24時間以内に対応します。違反者は利用を停止します。"
        />

        <View style={styles.links}>
          <Pressable onPress={() => Linking.openURL(`${SITE_URL}/terms`)}>
            <Text style={styles.link}>利用規約</Text>
          </Pressable>
          <Text style={styles.dot}>・</Text>
          <Pressable onPress={() => Linking.openURL(`${SITE_URL}/privacy`)}>
            <Text style={styles.link}>プライバシーポリシー</Text>
          </Pressable>
        </View>

        <Pressable style={styles.button} onPress={onDone}>
          <Text style={styles.buttonText}>同意して始める</Text>
        </Pressable>
        <Text style={styles.note}>
          「同意して始める」を押すと、利用規約・プライバシーポリシー、および
          不適切なコンテンツ・迷惑行為を一切許容しない方針に同意したものとみなします。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.sectionBody}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionText}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { padding: 24, flexGrow: 1, justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 10 },
  lead: { color: "#bbb", fontSize: 14, textAlign: "center", marginBottom: 22, lineHeight: 20 },
  section: { flexDirection: "row", gap: 12, marginBottom: 16, alignItems: "flex-start" },
  emoji: { fontSize: 26 },
  sectionBody: { flex: 1 },
  sectionTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 2 },
  sectionText: { color: "#bbb", fontSize: 13, lineHeight: 19 },
  links: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 8, marginBottom: 16 },
  link: { color: "#4ea3ff", fontSize: 13, textDecorationLine: "underline" },
  dot: { color: "#666", marginHorizontal: 8 },
  button: { backgroundColor: "#e63946", borderRadius: 8, padding: 15, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  note: { color: "#777", fontSize: 11, textAlign: "center", marginTop: 10, lineHeight: 16 },
});
