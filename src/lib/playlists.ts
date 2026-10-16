import type { Track } from "./youtube";

export type UserPlaylist = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  videos: Track[];
};

export const PLAYLISTS_STORAGE_KEY = "echo.user_playlists.v1";

/**
 * Load all user-created playlists from localStorage.
 * Automatically provides a default "পরে দেখব" (Watch Later) playlist
 * and migrates any old single queue if present.
 */
export function loadUserPlaylists(): UserPlaylist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
    if (!raw) {
      let migratedVideos: Track[] = [];
      try {
        const oldQueueRaw = localStorage.getItem("echo.queue.v1");
        if (oldQueueRaw) {
          const parsed = JSON.parse(oldQueueRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            migratedVideos = parsed;
          }
        }
      } catch {
        /* ignore */
      }

      const initial: UserPlaylist[] = [
        {
          id: "pl_watch_later",
          title: "পরে দেখব",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          videos: migratedVideos,
        },
      ];
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const list = JSON.parse(raw) as UserPlaylist[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Persist playlists to localStorage.
 */
export function saveUserPlaylists(playlists: UserPlaylist[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists));
  } catch {
    /* ignore storage quota errors */
  }
}

/**
 * Create a new custom playlist.
 */
export function createPlaylist(title: string, initialTrack?: Track): UserPlaylist {
  const playlists = loadUserPlaylists();
  const trimmed = title.trim() || "নতুন প্লেলিস্ট";
  const newPl: UserPlaylist = {
    id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: trimmed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    videos: initialTrack
      ? [{ id: initialTrack.id, title: initialTrack.title, author: initialTrack.author, thumbnail: initialTrack.thumbnail }]
      : [],
  };
  const updated = [newPl, ...playlists];
  saveUserPlaylists(updated);
  return newPl;
}

/**
 * Delete a playlist by ID.
 */
export function deletePlaylist(playlistId: string): UserPlaylist[] {
  const playlists = loadUserPlaylists().filter((p) => p.id !== playlistId);
  saveUserPlaylists(playlists);
  return playlists;
}

/**
 * Rename an existing playlist.
 */
export function renamePlaylist(playlistId: string, newTitle: string): UserPlaylist[] {
  const playlists = loadUserPlaylists().map((p) => {
    if (p.id === playlistId) {
      return { ...p, title: newTitle.trim() || p.title, updatedAt: Date.now() };
    }
    return p;
  });
  saveUserPlaylists(playlists);
  return playlists;
}

/**
 * Toggle a track inside a playlist (add if not present, remove if present).
 * Returns whether it was added or removed and the playlist title.
 */
export function toggleTrackInPlaylist(
  playlistId: string,
  track: Track,
): { added: boolean; playlistTitle: string; playlists: UserPlaylist[] } {
  const playlists = loadUserPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return { added: false, playlistTitle: "", playlists };

  const existingIdx = pl.videos.findIndex((v) => v.id === track.id);
  let added = false;
  if (existingIdx !== -1) {
    pl.videos.splice(existingIdx, 1);
    added = false;
  } else {
    pl.videos.unshift({
      id: track.id,
      title: track.title,
      author: track.author,
      thumbnail: track.thumbnail,
    });
    added = true;
  }
  pl.updatedAt = Date.now();
  saveUserPlaylists(playlists);
  return { added, playlistTitle: pl.title, playlists };
}

/**
 * Add a track to a playlist if not already present.
 */
export function addTrackToPlaylist(playlistId: string, track: Track): { ok: boolean; playlists: UserPlaylist[] } {
  const playlists = loadUserPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return { ok: false, playlists };
  if (pl.videos.some((v) => v.id === track.id)) return { ok: false, playlists };

  pl.videos.unshift({
    id: track.id,
    title: track.title,
    author: track.author,
    thumbnail: track.thumbnail,
  });
  pl.updatedAt = Date.now();
  saveUserPlaylists(playlists);
  return { ok: true, playlists };
}

/**
 * Remove a track from a specific playlist.
 */
export function removeTrackFromPlaylist(playlistId: string, trackId: string): UserPlaylist[] {
  const playlists = loadUserPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return playlists;
  pl.videos = pl.videos.filter((v) => v.id !== trackId);
  pl.updatedAt = Date.now();
  saveUserPlaylists(playlists);
  return playlists;
}

/**
 * Returns an array of playlist IDs that currently contain this video ID.
 */
export function getPlaylistIdsForTrack(playlists: UserPlaylist[], trackId: string): string[] {
  return playlists.filter((p) => p.videos.some((v) => v.id === trackId)).map((p) => p.id);
}
