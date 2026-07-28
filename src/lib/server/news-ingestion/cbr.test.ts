import { describe, expect, it } from "vitest";
import { cbrRssPressUrl, fetchCbrRssFeed, parseCbrRssFeed } from "./cbr";

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

function encodeWindows1251(value: string) {
  return Uint8Array.from(Array.from(value).map((char) => {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) return code;
    if (code === 0x0401) return 0xa8;
    if (code === 0x0451) return 0xb8;
    if (code >= 0x0410 && code <= 0x044f) return code - 0x0350;
    throw new Error(`Unsupported test character: ${char}`);
  }));
}

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

  it("decodes windows-1251 CBR responses before parsing", async () => {
    const encoded = encodeWindows1251(`<?xml version="1.0" encoding="windows-1251"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Банк России</title>
      <link>/press/pr/?file=artifact-test.htm</link>
      <pubDate>Thu, 23 Jul 2026 10:00:00 +0300</pubDate>
      <description>Описание</description>
    </item>
  </channel>
</rss>`);

    const documents = await fetchCbrRssFeed({
      fetchImpl: async () => new Response(encoded, {
        status: 200,
        headers: { "content-type": "text/xml; charset=windows-1251" },
      }),
      limit: 1,
    });

    expect(documents[0]).toMatchObject({
      title: "Банк России",
      rawExcerpt: "Описание",
      url: "https://www.cbr.ru/press/pr/?file=artifact-test.htm",
    });
  });
});
