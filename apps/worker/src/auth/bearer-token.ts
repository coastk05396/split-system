/** Extracts the single Bearer token accepted by HTTP and live-connection routes. */
export function bearerToken(authorization: string | undefined): string | undefined {
  return /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
}
