export type PortfolioEventLike = {
  event_date: string;
  event_type: string;
  status: string;
};

export type EventFilterInput = {
  type?: string | null;
};

export function filterPortfolioEvents<T extends PortfolioEventLike>(events: T[], filters: EventFilterInput) {
  const type = filters.type?.trim();
  return events.filter((event) => !type || event.event_type === type);
}

export function splitPortfolioEvents<T extends PortfolioEventLike>(events: T[], today: string) {
  const upcoming: T[] = [];
  const history: T[] = [];

  for (const event of events) {
    if (event.event_date >= today && event.status !== "cancelled" && event.status !== "done") {
      upcoming.push(event);
    } else {
      history.push(event);
    }
  }

  return {
    upcoming: upcoming.sort((left, right) => left.event_date.localeCompare(right.event_date)),
    history: history.sort((left, right) => right.event_date.localeCompare(left.event_date)),
  };
}
