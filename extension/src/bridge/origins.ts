export const PRODUCTION_SITE_ORIGIN = "https://verdict.tools";

export const PRODUCTION_SITE_MATCH = `${PRODUCTION_SITE_ORIGIN}/*`;
export const DEVELOPMENT_SITE_MATCH = "http://localhost/*";

export const SITE_MATCHES = [PRODUCTION_SITE_MATCH, DEVELOPMENT_SITE_MATCH];

export function isTrustedSiteOrigin(origin: string | undefined, development: boolean): boolean {
  if (origin === undefined) {
    return false;
  }
  if (origin === PRODUCTION_SITE_ORIGIN) {
    return true;
  }
  if (!development) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" && parsed.hostname === "localhost" && parsed.origin === origin;
}

export interface MessageSenderShape {
  origin?: string;
  url?: string;
}

export function senderOrigin(sender: MessageSenderShape): string | undefined {
  if (sender.origin !== undefined && sender.origin !== "") {
    return sender.origin;
  }
  if (sender.url === undefined) {
    return undefined;
  }
  try {
    return new URL(sender.url).origin;
  } catch {
    return undefined;
  }
}

interface ManifestShape {
  externally_connectable?: { matches?: string[]; ids?: string[] };
  content_scripts?: { matches?: string[] }[];
}

// store builds never trust localhost
export function withoutDevelopmentOrigins<T extends ManifestShape>(manifest: T): T {
  const keep = (matches: string[] | undefined) =>
    matches?.filter((match) => match !== DEVELOPMENT_SITE_MATCH);

  if (manifest.externally_connectable?.matches !== undefined) {
    manifest.externally_connectable.matches = keep(manifest.externally_connectable.matches);
  }
  if (manifest.content_scripts !== undefined) {
    manifest.content_scripts = manifest.content_scripts
      .map((script) => ({ ...script, matches: keep(script.matches) }))
      .filter((script) => script.matches === undefined || script.matches.length > 0);
  }
  return manifest;
}
