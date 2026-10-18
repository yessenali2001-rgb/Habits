import { signFeedToken } from './crypto';
import { siteUrl } from './env';

/** The subscription URL for (user, trip | all trips, version). Server-only: it signs with FEED_SIGNING_SECRET. */
export const feedUrlFor = (userId: string, tripId: string | null, version: number) =>
  `${siteUrl()}/api/ical/${signFeedToken({ userId, tripId, version })}.ics`;
