import { BlockList } from 'node:net';
import { describe, expect, it } from 'vitest';
import { checkUrl, isSafeAddress, parseIPv4, parseIPv6 } from '../src/netguard.js';

describe('IPv4: public addresses are safe, every special range is not', () => {
  const safe = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '151.101.1.69', '172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '169.253.255.255', '198.17.255.255', '198.20.0.0', '223.255.255.255'];
  const unsafe = ['0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.255.255.254', '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '100.64.0.1', '100.127.255.255', '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255'];
  it.each(safe)('%s is safe', (ip) => expect(isSafeAddress(ip)).toBe(true));
  it.each(unsafe)('%s is refused', (ip) => expect(isSafeAddress(ip)).toBe(false));
  it('matches Node\'s own BlockList on boundaries and 20,000 random addresses', () => {
    const bl = new BlockList();
    const ranges: Array<[string, number]> = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];
    for (const [n, p] of ranges) bl.addSubnet(n, p, 'ipv4');
    const edge: string[] = [];
    for (const [n, p] of ranges) {
      const b = parseIPv4(n)!; const base = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0; const size = 2 ** (32 - p);
      for (const x of [base - 1, base, base + 1, base + size - 1, base + size]) { const v = x >>> 0; edge.push(`${v >>> 24}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`); }
    }
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
    const random = Array.from({ length: 20_000 }, () => { const v = rnd(); return `${v >>> 24}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`; });
    for (const ip of [...edge, ...random]) expect(isSafeAddress(ip), ip).toBe(!bl.check(ip, 'ipv4'));
  });
});

describe('IPv6: only global unicast is safe, and wrapped IPv4 is judged by the IPv4 inside', () => {
  const safe = ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4009:81a::200e', '2620:fe::fe', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1'];
  const unsafe = [
    '::', '::1', '::0', '0:0:0:0:0:0:0:1',
    'fe80::1', 'fe80::dead:beef', 'febf::1', 'fc00::1', 'fd12:3456:789a::1', 'fec0::1', 'ff02::1', 'ff00::',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:192.168.1.1', '::ffff:c0a8:101',
    '::127.0.0.1', '::7f00:1', '::10.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a00:1', '64:ff9b:1::1',
    '2002:7f00:1::', '2002:a00:1::1', '2002:a9fe:a9fe::1',
    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '3fff::1', '100::1', '4000::1', '8000::1', 'a000::1',
  ];
  it.each(safe)('%s is safe', (ip) => expect(isSafeAddress(ip)).toBe(true));
  it.each(unsafe)('%s is refused', (ip) => expect(isSafeAddress(ip), ip).toBe(false));
  it('refuses a zone id and anything malformed', () => {
    for (const bad of ['fe80::1%eth0', ':::', '1::2::3', '12345::1', 'g::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', '::ffff:999.1.1.1', '::1.2.3', '']) expect(isSafeAddress(bad), bad).toBe(false);
  });
  it('parses an address into bytes', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::ffff:1.2.3.4')!.slice(10)).toEqual([255, 255, 1, 2, 3, 4]);
    expect(parseIPv6('2001:db8::')!.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
  });
});

describe('what is not an IP address is not safe', () => {
  it('refuses disguised and non-literal forms', () => {
    for (const bad of ['localhost', 'example.com', '127.1', '0x7f.0.0.1', '017700000001', '2130706433', '127.000.000.001', '01.2.3.4', '1.2.3', '256.1.1.1', ' ', 'null', undefined as unknown as string]) expect(isSafeAddress(bad), String(bad)).toBe(false);
  });
});

describe('checkUrl', () => {
  const ok = (u: string) => expect(checkUrl(u), u).toMatchObject({ ok: true });
  const no = (u: string, why?: RegExp) => { const r = checkUrl(u); expect(r.ok, u).toBe(false); if (why && !r.ok) expect(r.reason, u).toMatch(why); };
  it('accepts ordinary public https and http links, with paths, queries and a trailing dot', () => {
    ok('https://example.com/paper.pdf'); ok('http://example.com/'); ok('https://www.reuters.com/a/b?c=d#e'); ok('https://example.com./x'); ok('https://EXAMPLE.com/x'); ok('https://8.8.8.8/'); ok('https://[2606:4700:4700::1111]/'); ok('https://example.com:443/'); ok('http://example.com:80/');
  });
  it('refuses every scheme but http and https', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/', 'javascript:alert(1)', 'data:text/html,<script>', 'ws://example.com/', 'jar:http://example.com!/', 'dict://example.com:11211/', 'ldap://example.com/']) no(u, /scheme|valid/);
  });
  it('refuses credentials in the URL', () => { no('https://user:pass@example.com/', /credentials/); no('https://user@example.com/', /credentials/); no('http://example.com@127.0.0.1/', /credentials/); });
  it('refuses localhost in every spelling, and names that only resolve inside a network', () => {
    for (const u of ['http://localhost/', 'http://LOCALHOST/', 'http://localhost./', 'http://foo.localhost/', 'http://a.b.localhost:80/', 'http://printer.local/', 'http://metadata.google.internal/', 'http://x.internal/', 'http://host.localdomain/', 'http://router.home.arpa/', 'http://nas.lan/', 'http://intranet/', 'http://router/', 'https://corp/']) no(u);
  });
  it('refuses every way of writing a private address (the URL parser canonicalises them first)', () => {
    for (const u of ['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://017700000001/', 'http://127.1/', 'http://0/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[::]/', 'http://169.254.169.254/latest/meta-data/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://3232235777/', 'http://0xa9fea9fe/', 'http://0251.0376.0251.0376/']) no(u);
  });
  it('refuses unusual ports unless allowed', () => {
    for (const p of [22, 25, 3306, 5432, 6379, 8080, 9200, 11211, 27017]) no(`https://example.com:${p}/`, /port/);
    expect(checkUrl('https://example.com:8443/', { allowPorts: [443, 8443] }).ok).toBe(true);
  });
  it('refuses a URL that is not a URL, and empties', () => { no('not a url'); no(''); no('http://'); no('//example.com'); no(undefined as unknown as string); });
  it('refuses a host of only digits and dots that is not a valid address', () => { no('http://1.2.3.4.5/'); no('http://999.999.999.999/'); });
});
