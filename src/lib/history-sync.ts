import { supabase } from "@/integrations/supabase/client";
import { HISTORY_KEY, loadHistory, type HistoryItem } from "@/lib/youtube";

const MAX = 30;

type Row = {
  video_id: string;
  title: string;
  author: string;
  thumbnail: string;
  watched_at: string;
  position: number;
  duration: number;
};

const toItem = (r: Row): HistoryItem => ({
  id: r.video_id,
  title: r.title,
  author: r.author,
  thumbnail: r.thumbnail,
  at: new Date(r.watched_at).getTime(),
  position: r.position,
  duration: r.duration,
});

const toRow = (userId: string, h: HistoryItem) => ({
  user_id: userId,
  video_id: h.id,
  title: h.title,
  author: h.author,
  thumbnail: h.thumbnail,
  watched_at: new Date(h.at).toISOString(),
  position: h.position,
  duration: h.duration,
});

export async function fetchCloudHistory(): Promise<HistoryItem[]> {
  const { data, error } = await supabase
    .from("watch_history")
    .select("video_id,title,author,thumbnail,watched_at,position,duration")
    .order("watched_at", { ascending: false })
    .limit(MAX);
  if (error) throw error;
  return (data ?? []).map(toItem);
}

export async function upsertCloudHistory(userId: string, item: HistoryItem) {
  const { error } = await supabase.from("watch_history").upsert(toRow(userId, item), { onConflict: "user_id,video_id" });
  if (error) console.warn("history sync failed", error.message);
}

export async function updateCloudPosition(userId: string, id: string, position: number, duration: number) {
  const { error } = await supabase
    .from("watch_history")
    .update({ position, duration })
    .eq("user_id", userId)
    .eq("video_id", id);
  if (error) console.warn("position sync failed", error.message);
}

export async function clearCloudHistory(userId: string) {
  const { error } = await supabase.from("watch_history").delete().eq("user_id", userId);
  if (error) console.warn("clear sync failed", error.message);
}

/** On sign-in: merge local history into the cloud (newest wins), then return the merged list and cache it locally. */
export async function mergeHistoryOnSignIn(userId: string): Promise<HistoryItem[]> {
  const local = loadHistory();
  const cloud = await fetchCloudHistory();
  const map = new Map<string, HistoryItem>();
  for (const h of [...cloud, ...local]) {
    const prev = map.get(h.id);
    if (!prev || h.at > prev.at) map.set(h.id, h);
  }
  const merged = [...map.values()].sort((a, b) => b.at - a.at).slice(0, MAX);
  const toPush = merged.filter((m) => {
    const c = cloud.find((x) => x.id === m.id);
    return !c || c.at < m.at;
  });
  if (toPush.length) {
    const { error } = await supabase
      .from("watch_history")
      .upsert(toPush.map((h) => toRow(userId, h)), { onConflict: "user_id,video_id" });
    if (error) console.warn("merge sync failed", error.message);
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  return merged;
}
