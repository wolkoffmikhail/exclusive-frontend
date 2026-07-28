import { describe, expect, it } from "vitest";
import { decodeFeedText, parseForeignInsightFeed } from "./foreign-feeds";

describe("foreign insight feeds", () => {
  it("parses SEC EDGAR Atom filings with issuer and form metadata", () => {
    const documents = parseForeignInsightFeed(`
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>8-K - Example Corp (0001234567) (Filer)</title>
          <link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/example-index.htm" />
          <summary type="html">&lt;b&gt;Filed:&lt;/b&gt; 2026-07-27&lt;br&gt;Item 2.02: Results of Operations</summary>
          <updated>2026-07-27T17:30:53-04:00</updated>
          <category label="form type" term="8-K" />
          <id>urn:tag:sec.gov,2008:accession-number=0000000000-26-000001</id>
        </entry>
      </feed>
    `, "sec_edgar", 10);

    expect(documents[0]).toMatchObject({
      sourceCode: "sec_edgar",
      externalId: "urn:tag:sec.gov,2008:accession-number=0000000000-26-000001",
      issuerName: "Example Corp",
      documentType: "sec_8_k",
      language: "en",
      trustLevel: "primary",
      rawExcerpt: "Filed: 2026-07-27 Item 2.02: Results of Operations",
    });
  });

  it("parses RSS insight feeds and decodes nested HTML entities", () => {
    const documents = parseForeignInsightFeed(`
      <rss>
        <channel>
          <item>
            <title>Rates &amp;amp; liquidity update</title>
            <link>/press/test.en.html</link>
            <guid>ecb-test-1</guid>
            <pubDate>Tue, 28 Jul 2026 09:00:00 GMT</pubDate>
            <description>Markets&amp;nbsp;reacted to a 4&amp;ndash;5% range.</description>
          </item>
        </channel>
      </rss>
    `, "ecb_blog", 10);

    expect(documents[0]).toMatchObject({
      sourceCode: "ecb_blog",
      externalId: "ecb-test-1",
      title: "Rates & liquidity update",
      documentType: "insight",
      rawExcerpt: "Markets reacted to a 4-5% range.",
    });
    expect(decodeFeedText("A&amp;nbsp;B&amp;mdash;C")).toBe("A B-C");
  });
});
