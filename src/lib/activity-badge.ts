const NEWEST_KEY = "activity_newest_at";
const VIEWED_KEY = "activity_viewed_at";

export function markLatestActivity(timestamp: string): void {
  const current = localStorage.getItem(NEWEST_KEY);
  if (!current || timestamp > current) {
    localStorage.setItem(NEWEST_KEY, timestamp);
  }
}

export function markActivityViewed(): void {
  localStorage.setItem(VIEWED_KEY, new Date().toISOString());
}

export function hasUnreadActivity(): boolean {
  const newest = localStorage.getItem(NEWEST_KEY);
  if (!newest) return false;
  const viewed = localStorage.getItem(VIEWED_KEY);
  if (!viewed) return true;
  return newest > viewed;
}
