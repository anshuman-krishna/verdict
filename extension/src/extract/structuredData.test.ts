// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  isStructuredSource,
  localName,
  newPageIndex,
  readMicrodata,
  readRdfa,
} from "./structuredData";

function parse(html: string): ParentNode {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("localName", () => {
  it("reduces the three ways a page can spell a type to the one the rules match on", () => {
    expect(localName("https://schema.org/Product")).toBe("Product");
    expect(localName("http://schema.org/Product")).toBe("Product");
    expect(localName("schema:Product")).toBe("Product");
    expect(localName("Product")).toBe("Product");
  });

  it("reads a trailing slash and a fragment as the separators they are", () => {
    expect(localName("https://schema.org/Product/")).toBe("Product");
    expect(localName("https://example.com/vocab#Product")).toBe("Product");
  });

  it("is empty for a token that names nothing", () => {
    expect(localName("   ")).toBe("");
    expect(localName("/")).toBe("");
  });
});

describe("readMicrodata", () => {
  it("reads a product into the shape a json-ld path already expects", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <h1 itemprop="name">Stovetop Kettle</h1>
          <span itemprop="category">Kitchen</span>
        </div>
      `),
    );
    expect(items).toEqual([
      { "@type": "Product", name: "Stovetop Kettle", category: "Kitchen" },
    ]);
  });

  it("nests an item that is a property of another item", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Kettle</span>
          <div itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">
            <meta itemprop="ratingValue" content="4.6">
            <meta itemprop="reviewCount" content="8000">
          </div>
        </div>
      `),
    );
    expect(items).toEqual([
      {
        "@type": "Product",
        name: "Kettle",
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: "4.6",
          reviewCount: "8000",
        },
      },
    ]);
  });

  it("collects a repeated property into a list, which is how json-ld writes it", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="category">Home</span>
          <span itemprop="category">Kitchen</span>
        </div>
      `),
    );
    expect(items[0]).toEqual({ "@type": "Product", category: ["Home", "Kitchen"] });
  });

  it("reads a value from where html keeps it, not from the text", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Review">
          <meta itemprop="name" content="from a meta">
          <time itemprop="datePublished" datetime="2024-03-02">two years ago</time>
          <data itemprop="position" value="7">seventh</data>
          <a itemprop="url" href="https://www.example.com/r/1">read it</a>
        </div>
      `),
    );
    expect(items[0]).toMatchObject({
      name: "from a meta",
      datePublished: "2024-03-02",
      position: "7",
    });
    expect(String((items[0] as Record<string, unknown>).url)).toContain("/r/1");
  });

  it("falls back to the text of a time element that carries no datetime", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Review">
          <time itemprop="datePublished">2 March 2024</time>
        </div>
      `),
    );
    expect(items[0]).toEqual({ "@type": "Review", datePublished: "2 March 2024" });
  });

  it("keeps reading past an element that carries a property but is not an item", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <div itemprop="description">
            a kettle
            <span itemprop="name">Kettle</span>
          </div>
        </div>
      `),
    );
    expect(items[0]).toMatchObject({ name: "Kettle" });
  });

  it("gives a nested item's own properties to the nested item alone", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <div itemprop="review" itemscope itemtype="https://schema.org/Review">
            <span itemprop="name">a review title</span>
          </div>
        </div>
      `),
    );
    expect(items[0]).toEqual({
      "@type": "Product",
      review: { "@type": "Review", name: "a review title" },
    });
  });

  it("follows itemref, because a page splits an item across its layout", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product" itemref="elsewhere">
          <span itemprop="name">Kettle</span>
        </div>
        <div id="elsewhere"><meta itemprop="category" content="Kitchen"></div>
      `),
    );
    expect(items[0]).toEqual({ "@type": "Product", name: "Kettle", category: "Kitchen" });
  });

  it("does not loop when itemref points back at the item that named it", () => {
    const items = readMicrodata(
      parse(`
        <div id="self" itemscope itemtype="https://schema.org/Product" itemref="self">
          <span itemprop="name">Kettle</span>
        </div>
      `),
    );
    expect(items[0]).toEqual({ "@type": "Product", name: "Kettle" });
  });

  it("carries several types as a list, which the rules match against element by element", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product https://schema.org/IndividualProduct">
          <span itemprop="name">Kettle</span>
        </div>
      `),
    );
    expect(items[0]).toMatchObject({ "@type": ["Product", "IndividualProduct"] });
  });

  it("reads itemid as the identifier json-ld spells the same way", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product" itemid="urn:asin:B0BXYZ1234">
          <span itemprop="name">Kettle</span>
        </div>
      `),
    );
    expect(items[0]).toMatchObject({ "@id": "urn:asin:B0BXYZ1234" });
  });

  it("drops a property that says nothing rather than recording an empty string", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Kettle</span>
          <meta itemprop="category" content="">
        </div>
      `),
    );
    expect(items[0]).toEqual({ "@type": "Product", name: "Kettle" });
  });

  it("gives one element's value to every property it names", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name headline">Kettle</span>
        </div>
      `),
    );
    expect(items[0]).toEqual({ "@type": "Product", name: "Kettle", headline: "Kettle" });
  });

  it("reports an item once, through the item that holds it", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product">
          <div itemprop="review" itemscope itemtype="https://schema.org/Review">
            <span itemprop="reviewBody">Boils fast.</span>
          </div>
        </div>
      `),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ "@type": "Product" });
  });

  it("reports an item nobody claimed as a property on its own", () => {
    const items = readMicrodata(
      parse(`
        <div itemscope itemtype="https://schema.org/Product"></div>
        <div itemscope itemtype="https://schema.org/Review"></div>
      `),
    );
    expect(items).toEqual([{ "@type": "Product" }, { "@type": "Review" }]);
  });

  it("stops rather than following markup nested past any depth a page needs", () => {
    const deep = "<div itemprop=\"x\" itemscope>".repeat(200);
    const items = readMicrodata(
      parse(`<div itemscope itemtype="https://schema.org/Product">${deep}</div>`),
    );
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items).length).toBeLessThan(2_000);
  });

  it("reads a page that has no microdata as no items, not as an error", () => {
    expect(readMicrodata(parse("<div><p>just a page</p></div>"))).toEqual([]);
  });

  it("reads an item with a type and nothing else as nothing to report", () => {
    expect(readMicrodata(parse('<div itemscope itemtype="https://schema.org/Thing"></div>')))
      .toEqual([{ "@type": "Thing" }]);
  });
});

describe("readRdfa", () => {
  it("reads rdfa lite into the same shape as microdata and json-ld", () => {
    const items = readRdfa(
      parse(`
        <div vocab="https://schema.org/" typeof="Product">
          <h1 property="name">Stovetop Kettle</h1>
          <span property="category">Kitchen</span>
        </div>
      `),
    );
    expect(items).toEqual([
      { "@type": "Product", name: "Stovetop Kettle", category: "Kitchen" },
    ]);
  });

  it("prefers the content attribute, which is where rdfa puts a machine value", () => {
    const items = readRdfa(
      parse(`
        <div typeof="Product">
          <div property="aggregateRating" typeof="AggregateRating">
            <span property="ratingValue" content="4.6">4.6 out of 5</span>
          </div>
        </div>
      `),
    );
    expect(items[0]).toEqual({
      "@type": "Product",
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6" },
    });
  });

  it("strips a curie prefix from a type and a property alike", () => {
    const items = readRdfa(
      parse('<div typeof="schema:Product"><span property="schema:name">Kettle</span></div>'),
    );
    expect(items[0]).toEqual({ "@type": "Product", name: "Kettle" });
  });

  it("reads resource as the identifier when nothing else carries the value", () => {
    const items = readRdfa(
      parse('<div typeof="Product" resource="#kettle"><span property="name">Kettle</span></div>'),
    );
    expect(items[0]).toMatchObject({ "@id": "#kettle" });
  });
});

describe("the page index", () => {
  it("reads a page once however many rules ask for it", () => {
    const root = parse('<div itemscope itemtype="https://schema.org/Product"></div>');
    const index = newPageIndex();
    expect(index.read(root, "microdata")).toBe(index.read(root, "microdata"));
  });

  it("keeps the serialisations apart", () => {
    const root = parse('<div itemscope itemtype="https://schema.org/Product"></div>');
    const index = newPageIndex();
    expect(index.read(root, "microdata")).toHaveLength(1);
    expect(index.read(root, "rdfa")).toHaveLength(0);
  });

  it("reads a second page separately from the first", () => {
    const index = newPageIndex();
    const first = parse('<div itemscope itemtype="https://schema.org/Product"></div>');
    const second = parse('<div itemscope itemtype="https://schema.org/Review"></div>');
    expect(index.read(first, "microdata")).not.toBe(index.read(second, "microdata"));
  });
});

describe("isStructuredSource", () => {
  it("accepts the three the interpreter has", () => {
    expect(["script", "microdata", "rdfa"].every(isStructuredSource)).toBe(true);
  });

  it("rejects anything a remote rules document could invent", () => {
    expect(isStructuredSource("rdfa-lite")).toBe(false);
    expect(isStructuredSource(undefined)).toBe(false);
    expect(isStructuredSource(7)).toBe(false);
  });
});
