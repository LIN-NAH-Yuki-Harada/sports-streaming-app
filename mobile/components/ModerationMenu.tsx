import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  REPORT_REASONS,
  submitReport,
  blockUser,
} from "../lib/moderation";

// 配信カードから開く「通報・ブロック」メニュー（App Store Guideline 1.2）。
// 通報理由を選んで送信 → 24時間以内に対応する旨を表示。配信者のブロックも可能。

export type ModerationTarget = {
  broadcastId?: string | null;
  broadcasterId: string; // ブロック/通報対象のユーザー
  shareCode?: string | null;
  label: string; // 「ホーム vs アウェイ」等の見出し
};

export function ModerationMenu({
  visible,
  target,
  currentUserId,
  onClose,
  onBlocked,
}: {
  visible: boolean;
  target: ModerationTarget | null;
  currentUserId: string | null;
  onClose: () => void;
  onBlocked?: (blockedId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!target) return null;
  const isSelf = currentUserId != null && currentUserId === target.broadcasterId;

  async function handleReport(reason: string) {
    if (!currentUserId || !target) return;
    setBusy(true);
    const r = await submitReport({
      reporterId: currentUserId,
      broadcastId: target.broadcastId ?? null,
      reportedUserId: target.broadcasterId,
      shareCode: target.shareCode ?? null,
      reason,
    });
    setBusy(false);
    onClose();
    if (r.ok) {
      Alert.alert(
        "通報を受け付けました",
        "ご報告ありがとうございます。内容を確認し、24時間以内に対応します。",
      );
    } else {
      Alert.alert("送信に失敗しました", r.error ?? "時間をおいて再度お試しください。");
    }
  }

  function confirmBlock() {
    if (!currentUserId || !target) return;
    Alert.alert(
      "このユーザーをブロック",
      "ブロックすると、この配信者の配信・履歴が今後表示されなくなります。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "ブロックする",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            const r = await blockUser(currentUserId, target.broadcasterId);
            setBusy(false);
            onClose();
            if (r.ok) {
              onBlocked?.(target.broadcasterId);
              Alert.alert("ブロックしました", "今後この配信者の配信は表示されません。");
            } else {
              Alert.alert("失敗しました", r.error ?? "時間をおいて再度お試しください。");
            }
          },
        },
      ],
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* シート本体（タップ透過を止める） */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>通報・ブロック</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {target.label}
          </Text>

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color="#e63946" />
            </View>
          ) : (
            <>
              {isSelf ? (
                <Text style={styles.selfNote}>自分の配信は通報・ブロックできません。</Text>
              ) : (
                <>
                  <Text style={styles.section}>通報する理由を選択</Text>
                  {REPORT_REASONS.map((reason) => (
                    <Pressable
                      key={reason}
                      style={styles.reasonRow}
                      onPress={() => handleReport(reason)}
                    >
                      <Text style={styles.reasonText}>{reason}</Text>
                    </Pressable>
                  ))}

                  <Pressable style={styles.blockRow} onPress={confirmBlock}>
                    <Text style={styles.blockText}>このユーザーをブロック</Text>
                  </Pressable>
                </>
              )}
            </>
          )}

          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>キャンセル</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#161616",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    gap: 4,
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "800" },
  subtitle: { color: "#888", fontSize: 12, marginBottom: 8 },
  section: { color: "#bbb", fontSize: 12, fontWeight: "600", marginTop: 8, marginBottom: 2 },
  busy: { paddingVertical: 30, alignItems: "center" },
  selfNote: { color: "#999", fontSize: 13, paddingVertical: 16, textAlign: "center" },
  reasonRow: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  reasonText: { color: "#fff", fontSize: 15 },
  blockRow: { paddingVertical: 15, marginTop: 6 },
  blockText: { color: "#e63946", fontSize: 15, fontWeight: "700" },
  cancel: {
    marginTop: 10,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
  },
  cancelText: { color: "#ddd", fontSize: 15, fontWeight: "600" },
});
