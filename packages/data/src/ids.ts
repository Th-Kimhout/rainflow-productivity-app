/**
 * Id generation.
 *
 * Ids are minted in the browser, never by Postgres — an offline write has to know its own
 * primary key before it ever reaches the server, so no table carries a
 * `default gen_random_uuid()`. See ADR 0001, decision 6.
 *
 * `crypto.randomUUID` requires a secure context. That covers `localhost` and HTTPS, but
 * NOT a bare LAN IP — so testing on a phone needs `next dev --experimental-https` rather
 * than `http://192.168.x.x:3000`.
 */

export function newId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error(
      "crypto.randomUUID is unavailable. This needs a secure context — use localhost or " +
        "HTTPS (`next dev --experimental-https`), not a bare LAN IP.",
    );
  }
  return crypto.randomUUID();
}
