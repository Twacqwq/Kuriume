/** Media served by Kuriume's own proxy: the custom scheme (Windows, Linux) or
 *  the loopback server (Android, iOS, macOS MP4). The proxy answers CORS. */
export function isProxiedMedia(url: string): boolean {
  return /^(?:kuriume-media:|https?:\/\/kuriume-media\.localhost\/|http:\/\/127\.0\.0\.1:\d+\/)/.test(url);
}
