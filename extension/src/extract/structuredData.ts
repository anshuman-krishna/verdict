// schema.org ships in three serialisations and only one of them is json-ld. a page
// that says the same thing in microdata or rdfa lite says it in attributes, so it is
// read into the same shape and the rules keep one set of paths. SPEC.md section 9
// puts the page's own structured data above selectors for exactly this reason.

export type StructuredSource = "script" | "microdata" | "rdfa";

export const STRUCTURED_SOURCES: readonly StructuredSource[] = ["script", "microdata", "rdfa"];

export function isStructuredSource(value: unknown): value is StructuredSource {
  return typeof value === "string" && STRUCTURED_SOURCES.includes(value as StructuredSource);
}

// a page is untrusted input, so the walk is bounded rather than trusted to terminate
const MAX_NODES = 20_000;
const MAX_ITEMS = 2_000;
const MAX_DEPTH = 10;

interface Budget {
  nodes: number;
  items: number;
}

type Item = Record<string, unknown>;

// "https://schema.org/Product" and "schema:Product" both name Product, and the rules
// match on the json-ld spelling of it
export function localName(token: string): string {
  const trimmed = token.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    return "";
  }
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("#"));
  if (lastSeparator >= 0) {
    return trimmed.slice(lastSeparator + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  return colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
}

function tokens(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return value.split(/\s+/).filter((token) => token !== "");
}

function typeOf(raw: string | null): unknown {
  const named = tokens(raw).map(localName).filter((name) => name !== "");
  if (named.length === 0) {
    return undefined;
  }
  return named.length === 1 ? named[0] : named;
}

// a repeated property is a list, which is how json-ld writes the same thing
function addProperty(item: Item, name: string, value: unknown): void {
  const held = item[name];
  if (held === undefined) {
    item[name] = value;
    return;
  }
  if (Array.isArray(held)) {
    held.push(value);
    return;
  }
  item[name] = [held, value];
}

function textOf(element: Element): string {
  const text = element.textContent;
  return text === null ? "" : text.trim();
}

function attributeOf(element: Element, attribute: string): string {
  return element.getAttribute(attribute)?.trim() ?? "";
}

// the parser resolves a relative url against the page, which the raw attribute cannot
function urlOf(element: Element, attribute: string): string {
  const raw = attributeOf(element, attribute);
  if (raw === "") {
    return "";
  }
  const resolved = (element as unknown as Record<string, unknown>)[attribute];
  return typeof resolved === "string" && resolved !== "" ? resolved : raw;
}

const URL_ATTRIBUTE: Readonly<Record<string, string>> = {
  a: "href",
  area: "href",
  link: "href",
  audio: "src",
  embed: "src",
  iframe: "src",
  img: "src",
  source: "src",
  track: "src",
  video: "src",
  object: "data",
};

// html says where a value lives for each element, and it is not always the text
function microdataValue(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const urlAttribute = URL_ATTRIBUTE[tag];
  if (urlAttribute !== undefined) {
    return urlOf(element, urlAttribute);
  }
  switch (tag) {
    case "meta":
      return attributeOf(element, "content");
    case "data":
    case "meter":
      return attributeOf(element, "value");
    case "time":
      return attributeOf(element, "datetime") || textOf(element);
    default:
      return textOf(element);
  }
}

function rdfaValue(element: Element): string {
  const content = element.getAttribute("content");
  if (content !== null) {
    return content.trim();
  }
  const tag = element.tagName.toLowerCase();
  const urlAttribute = URL_ATTRIBUTE[tag];
  if (urlAttribute !== undefined) {
    const url = urlOf(element, urlAttribute);
    if (url !== "") {
      return url;
    }
  }
  return attributeOf(element, "resource") || textOf(element);
}

interface Dialect {
  // what starts an item, and what names a property on the enclosing one
  scopeAttribute: string;
  typeAttribute: string;
  propertyAttribute: string;
  idAttribute: string | null;
  referenceAttribute: string | null;
  value: (element: Element) => string;
}

const MICRODATA: Dialect = {
  scopeAttribute: "itemscope",
  typeAttribute: "itemtype",
  propertyAttribute: "itemprop",
  idAttribute: "itemid",
  referenceAttribute: "itemref",
  value: microdataValue,
};

const RDFA: Dialect = {
  scopeAttribute: "typeof",
  typeAttribute: "typeof",
  propertyAttribute: "property",
  idAttribute: "resource",
  referenceAttribute: null,
  value: rdfaValue,
};

// the tree the element sits in, which is the page itself only when the page is attached
function elementById(from: Element, id: string): Element | null {
  const root = from.getRootNode() as ParentNode & {
    getElementById?: (value: string) => Element | null;
  };
  if (typeof root.getElementById === "function") {
    return root.getElementById(id);
  }
  try {
    return root.querySelector(`[id="${id.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]`);
  } catch {
    return null;
  }
}

function referencedElements(element: Element, dialect: Dialect): Element[] {
  if (dialect.referenceAttribute === null) {
    return [];
  }
  const targets: Element[] = [];
  for (const id of tokens(element.getAttribute(dialect.referenceAttribute))) {
    const target = elementById(element, id);
    if (target !== null) {
      targets.push(target);
    }
  }
  return targets;
}

function buildItem(
  element: Element,
  dialect: Dialect,
  budget: Budget,
  open: Set<Element>,
  depth: number,
): Item | null {
  if (depth > MAX_DEPTH || budget.items <= 0 || open.has(element)) {
    return null;
  }
  budget.items -= 1;
  open.add(element);

  const item: Item = {};
  const type = typeOf(element.getAttribute(dialect.typeAttribute));
  if (type !== undefined) {
    item["@type"] = type;
  }
  if (dialect.idAttribute !== null) {
    const id = attributeOf(element, dialect.idAttribute);
    if (id !== "") {
      item["@id"] = id;
    }
  }

  const crawled = new Set<Element>([element]);
  for (const child of Array.from(element.children)) {
    collectProperties(child, item, dialect, budget, open, depth, crawled);
  }
  // an itemref target is read as though it sat inside the item, which is what it is for
  for (const target of referencedElements(element, dialect)) {
    collectProperties(target, item, dialect, budget, open, depth, crawled);
  }

  open.delete(element);
  return item;
}

function collectProperties(
  element: Element,
  item: Item,
  dialect: Dialect,
  budget: Budget,
  open: Set<Element>,
  depth: number,
  crawled: Set<Element>,
): void {
  if (budget.nodes <= 0 || crawled.has(element)) {
    return;
  }
  budget.nodes -= 1;
  crawled.add(element);

  const names = tokens(element.getAttribute(dialect.propertyAttribute));
  const scoped = element.hasAttribute(dialect.scopeAttribute);
  if (names.length > 0) {
    const value = scoped
      ? buildItem(element, dialect, budget, open, depth + 1)
      : emptyToNull(dialect.value(element));
    if (value !== null) {
      for (const name of names) {
        addProperty(item, localName(name), value);
      }
    }
  }
  // a nested item is this item's value, and its own properties belong to it
  if (scoped) {
    return;
  }
  for (const child of Array.from(element.children)) {
    collectProperties(child, item, dialect, budget, open, depth, crawled);
  }
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

function hasScopedAncestor(element: Element, root: ParentNode, dialect: Dialect): boolean {
  let parent = element.parentElement;
  while (parent !== null && (parent as ParentNode) !== root) {
    if (parent.hasAttribute(dialect.scopeAttribute)) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

// an item inside another item is reached through it, not alongside it
function outermostScopes(root: ParentNode, dialect: Dialect): Element[] {
  if (isElement(root) && root.hasAttribute(dialect.scopeAttribute)) {
    return [root];
  }
  try {
    return Array.from(root.querySelectorAll(`[${dialect.scopeAttribute}]`)).filter(
      (element) => !hasScopedAncestor(element, root, dialect),
    );
  } catch {
    return [];
  }
}

function isElement(node: ParentNode): node is Element & ParentNode {
  return typeof (node as Element).hasAttribute === "function";
}

function read(root: ParentNode, dialect: Dialect): unknown[] {
  const budget: Budget = { nodes: MAX_NODES, items: MAX_ITEMS };
  const items: unknown[] = [];
  for (const element of outermostScopes(root, dialect)) {
    const item = buildItem(element, dialect, budget, new Set<Element>(), 0);
    if (item !== null && Object.keys(item).length > 0) {
      items.push(item);
    }
  }
  return items;
}

export function readMicrodata(root: ParentNode): unknown[] {
  return read(root, MICRODATA);
}

export function readRdfa(root: ParentNode): unknown[] {
  return read(root, RDFA);
}

export function readStructuredData(root: ParentNode, source: StructuredSource): unknown[] {
  return source === "microdata" ? readMicrodata(root) : readRdfa(root);
}

// one pass over the page reads it for every rule that follows, and the index is built
// per extraction so a page that changed under a single-page navigation is read again
export interface PageIndex {
  read: (root: ParentNode, source: StructuredSource) => unknown[];
}

export function newPageIndex(): PageIndex {
  const byRoot = new WeakMap<ParentNode, Map<StructuredSource, unknown[]>>();
  return {
    read(root, source) {
      let bySource = byRoot.get(root);
      if (bySource === undefined) {
        bySource = new Map<StructuredSource, unknown[]>();
        byRoot.set(root, bySource);
      }
      const held = bySource.get(source);
      if (held !== undefined) {
        return held;
      }
      const items = readStructuredData(root, source);
      bySource.set(source, items);
      return items;
    },
  };
}
