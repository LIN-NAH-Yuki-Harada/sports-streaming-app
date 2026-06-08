import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

// React Native 用 Supabase クライアント。
// セッションは AsyncStorage に保存して、アプリ再起動後もログイン状態を維持する。
// detectSessionInUrl は RN では不要（URL からのセッション検出はWeb用）。
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
