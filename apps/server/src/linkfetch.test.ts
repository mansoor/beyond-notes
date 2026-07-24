import { describe, expect, it } from 'vitest'
import { isPrivateIp } from './linkfetch'

describe('SSRF address guard', () => {
  it('blocks private, loopback, link-local and reserved IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata endpoint
      '100.64.0.1', // CGNAT
      '198.18.0.1', // benchmarking
      '224.0.0.1', // multicast
      '255.255.255.255',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })

  it('blocks loopback, ULA, link-local and mapped IPv6', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', 'ff02::1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false)
  })

  it('refuses anything that is not a valid IP', () => {
    for (const s of ['not-an-ip', '', '999.1.1.1', '10.0.0']) {
      expect(isPrivateIp(s), s).toBe(true)
    }
  })
})
