import { XMLParser } from "fast-xml-parser";

export type RSSItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
};

export type RSSFeed = {
  channel: {
    title: string;
    link: string;
    description: string;
    item: RSSItem[];
  };
};

export async function fetchFeed(feedURL: string): Promise<RSSFeed> {
  // 1. جلب بيانات الـ RSS من الرابط مع تحديد الـ User-Agent
  const response = await fetch(feedURL, {
    headers: {
      "User-Agent": "gator",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.statusText}`);
  }

  const xmlText = await response.text();

  // 2. تحليل الـ XML باستخدام XMLParser
  const parser = new XMLParser({
    processEntities: false,
  });
  const parsedData = parser.parse(xmlText);

  // 3. التحقق من وجود حقل channel
  const channel = parsedData?.rss?.channel || parsedData?.channel;
  if (!channel) {
    throw new Error("Invalid RSS feed structure: missing channel field");
  }

  // 4. استخراج وتأكيد بيانات الـ Metadata الأساسية للـ Channel
  const title = channel.title;
  const link = channel.link;
  const description = channel.description;

  if (typeof title !== "string" || typeof link !== "string" || typeof description !== "string") {
    throw new Error("Invalid RSS feed: missing essential channel metadata");
  }

  // 5. استخراج عناصر الـ items ومعالجة حالتها (سواء كانت مصفوفة أو عنصراً واحداً أو فارغة)
  let rawItems: any[] = [];
  if (channel.item) {
    if (Array.isArray(channel.item)) {
      rawItems = channel.item;
    } else {
      rawItems = [channel.item];
    }
  }

  const items: RSSItem[] = [];

  for (const item of rawItems) {
    const itemTitle = item.title;
    const itemLink = item.link;
    const itemDescription = item.description;
    const itemPubDate = item.pubDate;

    // تخطي أي عنصر ينقصه أي من الحقول المطلوبة
    if (
      typeof itemTitle !== "string" ||
      typeof itemLink !== "string" ||
      typeof itemDescription !== "string" ||
      typeof itemPubDate !== "string"
    ) {
      continue;
    }

    items.push({
      title: itemTitle,
      link: itemLink,
      description: itemDescription,
      pubDate: itemPubDate,
    });
  }

  // 6. تجميع النتيجة النهائية بالشكل المطلوب
  return {
    channel: {
      title,
      link,
      description,
      item: items,
    },
  };
}
