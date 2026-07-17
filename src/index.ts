import { readConfig, setUser } from "./config.js";
import { createUser, getUser, deleteUsers, getUsers } from "./db/queries/users.js";
import { fetchFeed } from "./rss.js";
import {createFeed, Feed, User, getFeedsWithUsers, getFeedByUrl, createFeedFollow, getFeedFollowsForUser, deleteFeedFollow, getNextFeedToFetch, markFeedFetched} from "./db/queries/feeds.js";
import { createPost, getPostsForUser } from "./db/queries/posts.js";

type CommandHandler = (cmdName: string, ...args: string[]) => Promise<void>;

type UserCommandHandler = (cmdName: string, user: User, ...args: string[]) => Promise<void>;

interface CommandsRegistry {
  [key: string]: CommandHandler;
}

function middlewareLoggedIn(handler: UserCommandHandler): CommandHandler {
  return async (cmdName: string, ...args: string[]) => {
    const config = readConfig();
    const currentUserName = config.currentUserName;
    if (!currentUserName) {
      throw new Error("No user is currently logged in.");
    }

    const currentUser = await getUser(currentUserName);
    if (!currentUser) {
      throw new Error(`Current user '${currentUserName}' does not exist in the database.`);
    }

    await handler(cmdName, currentUser, ...args);
  };
}

function registerCommand(registry: CommandsRegistry, cmdName: string, handler: CommandHandler) {
  registry[cmdName] = handler;
}

function printFeedFollow(feedName: string, userName: string) {
  console.log(`* Feed: ${feedName}`);
  console.log(`  User: ${userName}`);
}

function parseDuration(durationStr: string): number {
  const regex = /^(\d+)(ms|s|m|h)$/;
  const match = durationStr.match(regex);

  if (!match) {
    throw new Error(`Invalid duration format: ${durationStr}. Use formats like 1s, 5m, 2h.`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "ms": return value;
    case "s":  return value * 1000;
    case "m":  return value * 60 * 1000;
    case "h":  return value * 60 * 60 * 1000;
    default:   return value;
  }
}

async function runCommand(registry: CommandsRegistry, cmdName: string, ...args: string[]) {
  const handler = registry[cmdName];
  if (!handler) {
    throw new Error(`Unknown command: ${cmdName}`);
  }
  await handler(cmdName, ...args);
}


async function handlerLogin(cmdName: string, ...args: string[]) {
  const username = args[0];
  if (!username) throw new Error("A username is required.");

  const user = await getUser(username);
  if (!user) throw new Error("User does not exist.");

  setUser(username);
  console.log(`User has been set to: ${username}`);
}


async function handlerRegister(cmdName: string, ...args: string[]) {
  const username = args[0];
  if (!username) throw new Error("A username is required.");

  const existingUser = await getUser(username);
  if (existingUser) {
    throw new Error("User already exists.");
  }

  try {
    const newUser = await createUser(username);
    setUser(username);
    console.log(`User created successfully:`, newUser);
  } catch (error: any) {
    if (error.code === '23505' || error.message?.includes('unique constraint')) {
      throw new Error("User already exists.");
    }
    throw error;
  }
}


async function handlerReset(cmdName: string, ...args: string[]) {
  try {
    await deleteUsers();
    console.log("Database has been reset successfully.");
  } catch (error: any) {
    throw new Error(`Failed to reset database: ${error.message}`);
  }
}


async function handlerUsers(cmdName: string, ...args: string[]) {
  try {
    const allUsers = await getUsers();
    const config = readConfig();
    const currentUser = config.currentUserName;

    for (const user of allUsers) {
      if (user.name === currentUser) {
        console.log(`* ${user.name} (current)`);
      } else {
        console.log(`* ${user.name}`);
      }
    }
  } catch (error: any) {
    throw new Error(`Failed to list users: ${error.message}`);
  }
}


async function scrapeFeeds() {
  const nextFeed = await getNextFeedToFetch();
  if (!nextFeed) {
    console.log("No feeds found in the database to scrape.");
    return;
  }

  console.log(`\n[${new Date().toLocaleTimeString()}] Fetching feed: "${nextFeed.name}" from ${nextFeed.url}...`);

  try {
    const parsedFeed = await fetchFeed(nextFeed.url);
    await markFeedFetched(nextFeed.id);

    let savedCount = 0;
    const items = parsedFeed.channel.item ?? [];

    for (const item of items) {
      let pubDate: Date | undefined = undefined;
      if (item.pubDate) {
        const parsedTimestamp = Date.parse(item.pubDate);
        if (!isNaN(parsedTimestamp)) {
          pubDate = new Date(parsedTimestamp);
        }
      }

      const newPost = await createPost({
        title: item.title,
        url: item.link,
        description: item.description,
        publishedAt: pubDate,
        feedId: nextFeed.id,
      });

      if (newPost) savedCount++;
    }

    console.log(`Scraped "${nextFeed.name}": Found ${items.length} posts, saved ${savedCount} new posts.`);
  } catch (error: any) {
    console.error(`Error scraping feed "${nextFeed.name}": ${error.message}`);
  }
}


async function handlerAgg(cmdName: string, ...args: string[]) {
  const durationStr = args[0];
  if (!durationStr) {
    throw new Error("A duration string (e.g., '1s', '1m') is required for the agg command.");
  }

  const timeBetweenRequests = parseDuration(durationStr);
  console.log(`Collecting feeds every ${durationStr}`);

  const handleError = (err: any) => console.error("Scraping error:", err);

  await scrapeFeeds().catch(handleError);

  const interval = setInterval(() => {
    scrapeFeeds().catch(handleError);
  }, timeBetweenRequests);

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      console.log("\nShutting down feed aggregator...");
      clearInterval(interval);
      resolve();
    });
  });
}


async function handlerAddFeed(cmdName: string, user: User, ...args: string[]) {
  const name = args[0];
  const url = args[1];

  if (!name || !url) {
    throw new Error("Both a name and a URL are required to add a feed.");
  }

  try {
    const newFeed = await createFeed(name, url, user.id);

    const followRelation = await createFeedFollow(user.id, newFeed.id);

    printFeedFollow(followRelation.feedName, followRelation.userName);
  } catch (error: any) {
    if (error.code === '23505' || error.message?.includes('unique constraint')) {
      throw new Error("A feed with this URL already exists.");
    }
    throw error;
  }
}


async function handlerFeeds(cmdName: string, ...args: string[]) {
  try {
    const feedsList = await getFeedsWithUsers();

    if (feedsList.length === 0) {
      console.log("No feeds found in the database.");
      return;
    }

    for (const feed of feedsList) {
      console.log(`* Name: ${feed.name}`);
      console.log(`  URL:  ${feed.url}`);
      console.log(`  User: ${feed.userName}`);
      console.log("----------------------------------------");
    }
  } catch (error: any) {
    throw new Error(`Failed to list feeds: ${error.message}`);
  }
}


async function handlerFollow(cmdName: string, user: User, ...args: string[]) {
  const url = args[0];
  if (!url) {
    throw new Error("A URL is required to follow a feed.");
  }

  const feed = await getFeedByUrl(url);
  if (!feed) {
    throw new Error(`No feed found with URL: ${url}`);
  }

  try {
    const followRelation = await createFeedFollow(user.id, feed.id);
    printFeedFollow(followRelation.feedName, followRelation.userName);
  } catch (error: any) {
    if (error.code === '23505' || error.message?.includes('unique constraint')) {
      throw new Error("You are already following this feed.");
    }
    throw error;
  }
}


async function handlerFollowing(cmdName: string, user: User, ...args: string[]) {
  const follows = await getFeedFollowsForUser(user.id);
  if (follows.length === 0) {
    console.log("You are not following any feeds.");
    return;
  }

  console.log(`Feeds followed by ${user.name}:`);
  for (const follow of follows) {
    console.log(`* ${follow.feedName}`);
  }
}


async function handlerUnfollow(cmdName: string, user: User, ...args: string[]) {
  const url = args[0];
  if (!url) {
    throw new Error("A URL is required to unfollow a feed.");
  }

  try {
    await deleteFeedFollow(user.id, url);
    console.log(`Successfully unfollowed feed with URL: ${url}`);
  } catch (error: any) {
    throw new Error(`Failed to unfollow feed: ${error.message}`);
  }
}

async function handlerBrowse(cmdName: string, user: User, ...args: string[]) {
  let limit = 2;
  if (args[0]) {
    const parsedLimit = parseInt(args[0], 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = parsedLimit;
    }
  }

  const postsList = await getPostsForUser(user.id, limit);

  if (postsList.length === 0) {
    console.log("No posts found. Make sure you are following feeds and the aggregator is running.");
    return;
  }

  console.log(`\nShowing latest ${postsList.length} posts for user ${user.name}:`);
  for (const post of postsList) {
    const pubDateStr = post.publishedAt ? new Date(post.publishedAt).toLocaleString() : "Unknown";
    console.log(`----------------------------------------`);
    console.log(`* Title: ${post.title}`);
    console.log(`  Source Feed Date: ${pubDateStr}`);
    console.log(`  URL:   ${post.url}`);
    if (post.description) {
      const cleanDesc = post.description.replace(/<[^>]*>/g, '').substring(0, 150);
      console.log(`  Summary: ${cleanDesc}...`);
    }
  }
}


async function main() {
  const registry: CommandsRegistry = {};

  registerCommand(registry, "login", handlerLogin);
  registerCommand(registry, "register", handlerRegister);
  registerCommand(registry, "reset", handlerReset);
  registerCommand(registry, "users", handlerUsers);
  registerCommand(registry, "agg", handlerAgg);
  registerCommand(registry, "feeds", handlerFeeds);

  registerCommand(registry, "addfeed", middlewareLoggedIn(handlerAddFeed));
  registerCommand(registry, "follow", middlewareLoggedIn(handlerFollow));
  registerCommand(registry, "following", middlewareLoggedIn(handlerFollowing));
  registerCommand(registry, "unfollow", middlewareLoggedIn(handlerUnfollow));
  registerCommand(registry, "browse", middlewareLoggedIn(handlerBrowse));

  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Error: Not enough arguments provided.");
    process.exit(1);
  }

  const cmdName = args[0];
  const cmdArgs = args.slice(1);

  try {
    await runCommand(registry, cmdName, ...cmdArgs);
    process.exit(0);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();