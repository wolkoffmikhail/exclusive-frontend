export type WatchlistItemLike = {
  item_type: string;
  status: string;
  updated_at: string;
};

export type WatchlistFilterInput = {
  type?: string | null;
  status?: string | null;
};

export function filterWatchlistItems<T extends WatchlistItemLike>(items: T[], filters: WatchlistFilterInput) {
  const type = filters.type?.trim();
  const status = filters.status?.trim();

  return items
    .filter((item) => {
      if (!type) return true;
      if (type === "news") return item.item_type === "news" || item.item_type === "idea";
      return item.item_type === type;
    })
    .filter((item) => !status || item.status === status)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}
