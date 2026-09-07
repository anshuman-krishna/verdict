# Published extraction rules

`amazon.json` is served from here, unchanged, at
`https://verdict.tools/rules/amazon.json`. That is the url the extension
fetches once a day (`extension/src/extract/remoteRules.ts`), and Astro
copies everything under `public/` verbatim, so this is a static file with no
server logic behind it and nothing to log.

PRIVACY.md section 3 lists that fetch as one of two allowed network requests
on an otherwise silent path, on the grounds that it "carries no parameters,
no cookie, and no identifier, and is identical for every user". Keeping it a
plain file in `public/` is what makes that true rather than merely intended.

The envelope is committed. It is a public artefact by definition, the site
is deployed from this repository, and having it in the history means the
version served on any given day can be checked afterwards rather than taken
on trust. The signing key is the secret, and it never lives here; see
`extension/scripts/sign-rules.mjs`.

It is produced by:

```
just sign-rules --key path/to/private-key.jwk.json
```

which signs `extension/src/extract/rules/amazon.json`, the same document the
extension bundles, and writes the envelope here.

Publishing is how a broken selector gets fixed within the day instead of
waiting on a store review (SPEC.md section 9):

1. edit `extension/src/extract/rules/amazon.json` and bump its `version`
2. `just sign-rules --key ...`
3. commit both files and deploy the site

The extension verifies the signature, refuses anything below the version it
already trusts, and falls back to its bundled copy if any of that fails. So
a bad publish costs the fix, never the analysis.

Nothing is served here yet: no keypair exists, and the source document has
no field rules until the fixture corpus exists to check them against
(PLAN.md week 1). Until then every fetch 404s and every extension uses its
bundled copy, which is the designed behaviour and not a fault.
