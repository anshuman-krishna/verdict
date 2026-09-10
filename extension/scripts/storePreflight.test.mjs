import { describe, expect, it } from "vitest";
import {
  PERMISSION_REASONS,
  breadthProblems,
  declaredHosts,
  hostProblems,
  hostsIn,
  modelProblems,
  permissionProblems,
  preflightProblems,
  remoteCodeProblems,
} from "./storePreflight.mjs";

const MANIFEST = {
  permissions: Object.keys(PERMISSION_REASONS),
  host_permissions: [],
  optional_host_permissions: ["https://api.verdict.tools/*"],
  externally_connectable: { matches: ["https://verdict.tools/*", "http://localhost/*"] },
  content_scripts: [{ matches: ["https://www.amazon.com/*", "https://www.amazon.fr/*"] }],
};

function file(text, path = "background.js") {
  return [{ path, text }];
}

describe("hostsIn", () => {
  it("finds every host in a blob of built javascript", () => {
    expect(hostsIn('fetch("https://api.verdict.tools/v1/x");a("https://www.amazon.fr/dp/1")')).toEqual(
      new Set(["api.verdict.tools", "www.amazon.fr"]),
    );
  });

  it("ignores a minified template literal fragment", () => {
    expect(hostsIn("`https://${host}/product-reviews/`")).toEqual(new Set());
  });

  it("finds localhost, which has no dot", () => {
    expect(hostsIn("http://localhost/*")).toEqual(new Set(["localhost"]));
  });

  it("ignores a port", () => {
    expect(hostsIn("http://localhost:4321/x")).toEqual(new Set(["localhost"]));
  });
});

describe("declaredHosts", () => {
  it("reads all four places a manifest can name a host", () => {
    expect(declaredHosts(MANIFEST)).toEqual(
      new Set(["api.verdict.tools", "verdict.tools", "localhost", "www.amazon.com", "www.amazon.fr"]),
    );
  });

  it("is empty for a manifest that names none", () => {
    expect(declaredHosts({})).toEqual(new Set());
  });
});

describe("hostProblems", () => {
  it("passes a bundle that only names declared hosts", () => {
    expect(hostProblems(MANIFEST, file('fetch("https://api.verdict.tools/v1/x")'))).toEqual([]);
  });

  it("catches a beacon to somewhere the manifest never mentioned", () => {
    const problems = hostProblems(MANIFEST, file('fetch("https://analytics.example.com/collect")'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/analytics\.example\.com/);
  });

  it("allows the site's own host, which needs no permission to reach", () => {
    expect(hostProblems(MANIFEST, file('"https://verdict.tools/rules/amazon.json"'))).toEqual([]);
  });

  it("reports a host once however many times it appears", () => {
    const text = 'a("https://x.example.com/1");b("https://x.example.com/2")';
    expect(hostProblems(MANIFEST, file(text))).toHaveLength(1);
  });

  it("names the file the host was found in", () => {
    const problems = hostProblems(MANIFEST, file('"https://x.example.com/"', "chunks/popup-a.js"));
    expect(problems[0]).toMatch(/^chunks\/popup-a\.js/);
  });

  describe("wildcard declarations", () => {
    const wildcard = { host_permissions: ["https://*.amazon.com/*"] };

    it("covers one leading label", () => {
      expect(hostProblems(wildcard, file('"https://www.amazon.com/x"'))).toEqual([]);
    });

    it("does not cover a deeper subdomain", () => {
      expect(hostProblems(wildcard, file('"https://a.b.amazon.com/x"'))).toHaveLength(1);
    });

    it("does not cover a different domain that merely ends the same way", () => {
      expect(hostProblems(wildcard, file('"https://notamazon.com/x"'))).toHaveLength(1);
    });
  });
});

describe("permissionProblems", () => {
  it("passes when the manifest and the reasons agree", () => {
    expect(permissionProblems(MANIFEST)).toEqual([]);
  });

  it("catches a permission nobody wrote a reason for", () => {
    const problems = permissionProblems({ ...MANIFEST, permissions: [...MANIFEST.permissions, "tabs"] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/"tabs"/);
  });

  it("catches a reason for a permission the manifest no longer asks for", () => {
    const problems = permissionProblems({ ...MANIFEST, permissions: ["storage"] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/has drifted/);
  });

  it("every reason says something, not just that the permission exists", () => {
    for (const [permission, reason] of Object.entries(PERMISSION_REASONS)) {
      expect(reason.length, permission).toBeGreaterThan(40);
    }
  });
});

describe("breadthProblems", () => {
  it.each([["<all_urls>"], ["*://*/*"], ["https://*/*"]])("refuses %s", (pattern) => {
    expect(breadthProblems({ host_permissions: [pattern] })).toHaveLength(1);
  });

  it("accepts a scoped storefront host", () => {
    expect(breadthProblems({ host_permissions: ["https://www.amazon.com/*"] })).toEqual([]);
  });

  it("checks optional host permissions too, since they are still asked for", () => {
    expect(breadthProblems({ optional_host_permissions: ["<all_urls>"] })).toHaveLength(1);
  });
});

describe("remoteCodeProblems", () => {
  it.each([
    ["eval", 'const x = eval("1 + 1");'],
    ["new Function", 'const f = new Function("return 1");'],
    ["document.write", 'document.write("<b>hi</b>");'],
    ["a remote script tag", '<script src="https://cdn.example.com/a.js"></script>'],
  ])("catches %s", (_label, text) => {
    expect(remoteCodeProblems(file(text))).toHaveLength(1);
  });

  it("passes ordinary bundled code", () => {
    expect(remoteCodeProblems(file("function evaluate(x){return x} evaluate(1)"))).toEqual([]);
  });
});

describe("preflightProblems", () => {
  it("passes a manifest and bundle that are shippable", () => {
    expect(preflightProblems(MANIFEST, file('fetch("https://api.verdict.tools/v1/x")'))).toEqual([]);
  });

  it("reports every problem at once rather than the first", () => {
    const manifest = { ...MANIFEST, permissions: ["tabs"], host_permissions: ["<all_urls>"] };
    const problems = preflightProblems(manifest, file('eval("1");fetch("https://x.example.com/")'));
    expect(problems.length).toBeGreaterThan(3);
  });
});

describe("modelProblems", () => {
  const PRESENT = {
    artifactVersion: 1,
    present: true,
    intercept: -1,
    coefficients: { "temporalBurst.burstFraction": 2 },
    calibration: [],
    featureQuantiles: { "temporalBurst.burstFraction": [0, 0.5, 1] },
  };

  it("passes a model that can impute every feature it weighs", () => {
    expect(modelProblems(PRESENT)).toEqual([]);
  });

  it("passes the absent artifact, which ships no scorer to gate", () => {
    expect(modelProblems({ artifactVersion: 1, present: false, reason: "none yet" })).toEqual([]);
  });

  it("refuses a model with no sketch for a feature it weighs", () => {
    const { featureQuantiles: _none, ...withoutSketch } = PRESENT;
    expect(modelProblems(withoutSketch)).toHaveLength(1);
  });

  it("names every uncovered feature, not just the first", () => {
    const model = {
      ...PRESENT,
      coefficients: { a: 1, b: 2 },
      featureQuantiles: {},
    };
    expect(modelProblems(model)[0]).toContain("a, b");
  });

  it("checks the reviewer graph slot too", () => {
    const model = {
      ...PRESENT,
      reviewerGraph: { intercept: 0, coefficients: { a: 1 }, calibration: [] },
    };
    expect(modelProblems(model)).toHaveLength(1);
    expect(modelProblems(model)[0]).toContain("reviewer graph");
  });

  it("refuses an empty sketch, which would impute nothing", () => {
    expect(
      modelProblems({ ...PRESENT, featureQuantiles: { "temporalBurst.burstFraction": [] } }),
    ).toHaveLength(1);
  });

  it("refuses something that is not an artifact at all", () => {
    expect(modelProblems(null)).toHaveLength(1);
    expect(modelProblems([])).toHaveLength(1);
  });
});
