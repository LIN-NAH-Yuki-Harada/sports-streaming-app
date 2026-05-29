"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/database";

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const p = await getProfile(user.id);
      setProfile(p);
    } catch {
      setProfile(null);
    }
  };

  useEffect(() => {
    const supabase = createClient();

    // onAuthStateChange が全てを処理する（getSession/getUser は使わない）
    // これが最もシンプルで確実な方法
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      // プロフィールはバックグラウンドで取得（loading をブロックしない）
      if (currentUser) {
        getProfile(currentUser.id)
          .then((p) => setProfile(p))
          .catch(() => setProfile(null));
      } else {
        setProfile(null);
      }

      // INITIAL_SESSION イベントで初期化完了
      if (event === "INITIAL_SESSION") {
        setLoading(false);
      }
    });

    // 安全策: 800ms 後に loading を強制解除。
    // 通常 INITIAL_SESSION は数十ms 以内に届くので、3秒は worst case の
    // 体感もっさり (= 描画ゲートしているページが最大3秒空白) を悪化させていた。
    // 800ms は localStorage 読み込み+rehydrate の現実的上限を確保しつつ、
    // 失敗時の体感を 1 秒未満に抑える。
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 800);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
