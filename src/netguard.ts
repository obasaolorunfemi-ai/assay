/* Which addresses and URLs is it safe to connect to on someone else's behalf?
   A citation link comes from AI text, which is shaped by whoever wrote the prompt, so a crafted one can point at your cloud metadata service
   (169.254.169.254) or an internal host. This decides, without touching the network, whether an address or URL is one a server may fetch.
   It is a pure function of its input: no DNS, no sockets. Anything it cannot read is refused. */

/** Parses a strict dotted-decimal IPv4 address. Null for anything else (leading zeros, short forms and 0x forms are refused: they are how a loopback address gets disguised). */
export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const out: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const part = m[i]!;
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Parses an IPv6 address (with `::` compression and an optional dotted IPv4 tail) into 16 bytes. Null for anything else, including zone ids ("fe80::1%eth0"). */
export function parseIPv6(input: string): number[] | null {
  const s = input.replace(/^\[|\]$/g, '').toLowerCase();
  if (!s.includes(':') || s.includes('%') || /[^0-9a-f:.]/.test(s)) return null;
  let tail: number[] = [];
  let head = s;
  const dot = s.lastIndexOf(':');
  if (s.slice(dot + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(dot + 1));
    if (!v4) return null;
    tail = v4;
    head = s.slice(0, dot + 1) + '0:0';          // two groups stand in for the four bytes, appended below
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === '' ? [] : h.split(':'));
  const left = toGroups(halves[0]!), right = halves.length === 2 ? toGroups(halves[1]!) : [];
  const all = [...left, ...right];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - all.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right].map((g) => parseInt(g, 16));
  if (groups.length !== 8) return null;
  const bytes = groups.flatMap((g) => [g >> 8, g & 255]);
  if (tail.length) { bytes[12] = tail[0]!; bytes[13] = tail[1]!; bytes[14] = tail[2]!; bytes[15] = tail[3]!; }
  return bytes;
}

const cidr4 = (b: number[], bits: number, base: number[]) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const x = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  const y = ((base[0]! << 24) | (base[1]! << 16) | (base[2]! << 8) | base[3]!) >>> 0;
  return (x & mask) === (y & mask);
};

/** Every IPv4 range that is not a public, routable address. */
const BLOCKED_V4: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8],        // "this network"
  [[10, 0, 0, 0], 8],       // private
  [[100, 64, 0, 0], 10],    // carrier-grade NAT
  [[127, 0, 0, 0], 8],      // loopback
  [[169, 254, 0, 0], 16],   // link-local, which includes the cloud metadata address
  [[172, 16, 0, 0], 12],    // private
  [[192, 0, 0, 0], 24],     // IETF protocol assignments
  [[192, 0, 2, 0], 24],     // documentation
  [[192, 88, 99, 0], 24],   // 6to4 relay (deprecated)
  [[192, 168, 0, 0], 16],   // private
  [[198, 18, 0, 0], 15],    // benchmarking
  [[198, 51, 100, 0], 24],  // documentation
  [[203, 0, 113, 0], 24],   // documentation
  [[224, 0, 0, 0], 4],      // multicast
  [[240, 0, 0, 0], 4],      // reserved, and the broadcast address
];

function safeV4(b: number[]): boolean {
  return !BLOCKED_V4.some(([base, bits]) => cidr4(b, bits, base));
}

function safeV6(b: number[]): boolean {
  const first12Zero = b.slice(0, 12).every((x) => x === 0);
  // Anything that merely WRAPS an IPv4 address is judged by the IPv4 address inside it, so a loopback or private address cannot be written in IPv6 to get past the list.
  const isMapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255;     // ::ffff:a.b.c.d  (and its hex form ::ffff:7f00:1)
  if (isMapped) return safeV4(b.slice(12));
  if (first12Zero) return false;                                                               // ::, ::1 and the deprecated IPv4-compatible form ::a.b.c.d
  const isNat64 = b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0);   // 64:ff9b::/96
  if (isNat64) return safeV4(b.slice(12));
  if (b[0] === 0x20 && b[1] === 0x02) return safeV4(b.slice(2, 6));                            // 2002::/16 (6to4) carries an IPv4 address in bytes 2 to 5
  // Only global unicast (2000::/3) is ever a public address; everything else (unique-local fc00::/7, link-local fe80::/10, site-local, multicast ff00::/8, discard 100::/64, local NAT64) is refused.
  if ((b[0]! & 0xe0) !== 0x20) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return false;         // 2001::/32 Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false;         // 2001:db8::/32 documentation
  if (b[0] === 0x3f && b[1] === 0xff && (b[2]! & 0xf0) === 0x00) return false;                // 3fff::/20 documentation
  return true;
}

/** True only for a public, routable IP address literal. False for private, loopback, link-local, reserved and wrapped-IPv4 forms of them, and for anything that is not an IP address at all. */
export function isSafeAddress(ip: string): boolean {
  const s = String(ip ?? '').trim();
  const v4 = parseIPv4(s);
  if (v4) return safeV4(v4);
  const v6 = parseIPv6(s);
  return v6 ? safeV6(v6) : false;
}

export interface UrlPolicy {
  /** Ports that may be connected to. Default 80 and 443: a link to a database or SSH port on a public address is not a citation. */
  allowPorts?: number[];
}
export type UrlDecision = { ok: true; url: URL; host: string } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.corp', '.intranet'];

/**
 * Is this a URL a server may fetch? http and https only; no credentials in it; an ordinary host name (not localhost, not a name that only resolves inside a network,
 * not a single-label name such as "router"); an IP literal only if it is public; and a normal port. The WHATWG URL parser has already turned 2130706433, 0x7f.1 and
 * [::ffff:7f00:1] into canonical addresses by the time they are checked here. This does NOT resolve the name: see the checker, which checks the address it actually connects to.
 */
export function checkUrl(raw: string, policy: UrlPolicy = {}): UrlDecision {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `the scheme ${u.protocol} is not allowed (http and https only)` };
  if (u.username || u.password) return { ok: false, reason: 'the URL contains credentials' };
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return { ok: false, reason: 'the URL has no host' };
  const ports = policy.allowPorts ?? [80, 443];
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (!ports.includes(port)) return { ok: false, reason: `port ${port} is not allowed` };
  if (parseIPv4(host) || host.includes(':')) {
    return isSafeAddress(host) ? { ok: true, url: u, host } : { ok: false, reason: 'the address is private, reserved or not a public address' };
  }
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'the host name is local or internal' };
  if (!host.includes('.')) return { ok: false, reason: 'a single-label host name resolves only inside a network' };
  // A name made only of digits and dots that did not parse as an address is an attempt at a disguised one.
  if (/^[0-9.]+$/.test(host)) return { ok: false, reason: 'the host looks like an IP address but is not a valid one' };
  return { ok: true, url: u, host };
}
