# Wire format fixtures

One file per request body the extension sends the service, written the way
it goes over the network. Both sides read these, the same way both scorers
read `tests/parity/vectors.jsonl`.

They exist because a mismatch here fails silently in exactly the place
nobody looks. `contributionBatch.json` was added after the service was found
rejecting every batch the extension actually sent, with a 422, while both
test suites passed: the Python tests wrote the field names the Python model
declared, and the TypeScript tests asserted the body the TypeScript built.
Neither side ever read the other's.

- `contributionBatch.json` is PRIVACY.md section 5's opt in contribution
  batch, posted to `/v1/graph/contribute`.
- `serviceLimits.json` is not a request body but the limits both sides must agree on: edges
  per contribution batch, the request body cap (also set in `service/deploy/Caddyfile`), the
  lookup bucket shape, and the longest accepted minhash signature. The extension splits its
  queue to fit them; the service refuses anything beyond them.

A change here is a change to a published interface, so it needs a version
bump on the endpoint rather than an edit in place.
