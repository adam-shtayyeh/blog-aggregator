import { eq, desc, and } from "drizzle-orm";
import { db } from "../index.js";
import { posts, feedFollows } from "../schema.js";

export type Post = typeof posts.$inferSelect;

export async function createPost(data: {
  title: string;
  url: string;
  description?: string;
  publishedAt?: Date;
  feedId: string;
}) {
  try {
    const [newPost] = await db
      .insert(posts)
      .values({
        title: data.title,
        url: data.url,
        description: data.description,
        publishedAt: data.publishedAt,
        feedId: data.feedId,
      })
      .onConflictDoNothing({ target: posts.url }) // يتجاهل الإدخال إذا كان الـ URL مكرراً
      .returning();
    return newPost;
  } catch (error) {
    return undefined;
  }
}

export async function getPostsForUser(userId: string, limit: number = 2) {
  return await db
    .select({
      id: posts.id,
      title: posts.title,
      url: posts.url,
      description: posts.description,
      publishedAt: posts.publishedAt,
      feedId: posts.feedId,
    })
    .from(posts)
    .innerJoin(feedFollows, eq(posts.feedId, feedFollows.feedId))
    .where(eq(feedFollows.userId, userId))
    .orderBy(desc(posts.publishedAt), desc(posts.createdAt))
    .limit(limit);
}