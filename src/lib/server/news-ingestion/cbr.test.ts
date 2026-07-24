import { describe, expect, it } from "vitest";
import { cbrRssPressUrl, parseCbrRssFeed } from "./cbr";

const rssFixture = `<?xml version="1.0" encoding="windows-1251"?>
<rss version="2.0">
  <channel>
    <title>Пресс-релизы Банка России</title>
    <item>
      <title><![CDATA[Банк России принял решение по рынку ценных бумаг]]></title>
      <link>/press/pr/?file=23072026_100000pr.htm</link>
      <guid>cbr-press-1</guid>
      <pubDate>Thu, 23 Jul 2026 10:00:00 +0300</pubDate>
      <description><![CDATA[Официальное сообщение Банка России.]]></description>
    </item>
    <item>
      <title>Второй пресс-релиз &amp; комментарий</title>
      <link>https://www.cbr.ru/press/pr/?file=23072026_110000pr.htm</link>
      <pubDate>Thu, 23 Jul 2026 11:00:00 +0300</pubDate>
      <description>Короткое описание</description>
    </item>
  </channel>
</rss>`;

describe("parseCbrRssFeed", () => {
  it("normalizes CBR RSS items into source documents", () => {
    const documents = parseCbrRssFeed(rssFixture, { feedUrl: cbrRssPressUrl });

    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      sourceCode: "cbr",
      externalId: "cbr-press-1",
      title: "Банк России принял решение по рынку ценных бумаг",
      url: "https://www.cbr.ru/press/pr/?file=23072026_100000pr.htm",
      documentType: "press_release",
      trustLevel: "primary",
      rawExcerpt: "Официальное сообщение Банка России.",
    });
    expect(documents[0].publishedAt).toBe("2026-07-23T07:00:00.000Z");
    expect(documents[1].title).toBe("Второй пресс-релиз & комментарий");
  });

  it("can limit parsed items", () => {
    expect(parseCbrRssFeed(rssFixture, { limit: 1 })).toHaveLength(1);
  });
});
