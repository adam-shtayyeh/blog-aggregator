import { eq , and, asc} from "drizzle-orm";
import { db } from "../index.js";
import { feeds, users,feedFollows } from "../schema.js";


export type Feed = typeof feeds.$inferSelect;
export type User = typeof users.$inferSelect;
export type FeedFollow = typeof feedFollows.$inferSelect;


export async function createFeed(name: string, url: string, userId: string): Promise<Feed> {
  const [newFeed] = await db
    .insert(feeds)
    .values({
      name,
      url,
      userId,
    })
    .returning();
  return newFeed;
}

export async function getFeedsWithUsers() {
  return await db
    .select({
      id: feeds.id,
      name: feeds.name,
      url: feeds.url,
      userName: users.name,
    })
    .from(feeds)
    .innerJoin(users, eq(feeds.userId, users.id));
}

export async function getFeedByUrl(url: string): Promise<Feed | undefined> {
  const [feed] = await db.select().from(feeds).where(eq(feeds.url, url)).limit(1);
  return feed;
}

export async function createFeedFollow(userId: string, feedId: string) {
  const [newFeedFollow] = await db
    .insert(feedFollows)
    .values({ userId, feedId })
    .returning();

  const [detailedFollow] = await db
    .select({
      id: feedFollows.id,
      createdAt: feedFollows.createdAt,
      updatedAt: feedFollows.updatedAt,
      userId: feedFollows.userId,
      feedId: feedFollows.feedId,
      userName: users.name,
      feedName: feeds.name,
    })
    .from(feedFollows)
    .innerJoin(users, eq(feedFollows.userId, users.id))
    .innerJoin(feeds, eq(feedFollows.feedId, feeds.id))
    .where(eq(feedFollows.id, newFeedFollow.id))
    .limit(1);

  return detailedFollow;
}

export async function getFeedFollowsForUser(userId: string) {
  return await db
    .select({
      id: feedFollows.id,
      createdAt: feedFollows.createdAt,
      updatedAt: feedFollows.updatedAt,
      userId: feedFollows.userId,
      feedId: feedFollows.feedId,
      userName: users.name,
      feedName: feeds.name,
    })
    .from(feedFollows)
    .innerJoin(users, eq(feedFollows.userId, users.id))
    .innerJoin(feeds, eq(feedFollows.feedId, feeds.id))
    .where(eq(feedFollows.userId, userId));
}

export async function deleteFeedFollow(userId: string, feedUrl: string): Promise<void> {
  const feedSubquery = db
    .select({ id: feeds.id })
    .from(feeds)
    .where(eq(feeds.url, feedUrl));

  await db
    .delete(feedFollows)
    .where(
      and(
        eq(feedFollows.userId, userId),
        eq(feedFollows.feedId, feedSubquery)
      )
    );
}

export async function getNextFeedToFetch(): Promise<Feed | undefined> {
  const [feed] = await db
    .select()
    .from(feeds)
    .orderBy(asc(feeds.lastFetchedAt))
    .limit(1);
  return feed;
}

export async function markFeedFetched(feedId: string): Promise<void> {
  await db
    .update(feeds)
    .set({
      lastFetchedAt: new Date(),

    })
    .where(eq(feeds.id, feedId));
}