import { describe, expect, it } from 'vitest'

/**
 * Mirrors publicUrlFor in apps/web/src/spaces.tsx. The sidebar's ↗ has to guess
 * where a published space is reachable, and guessing wrong sends you to a dead
 * link — so the rule is pinned here rather than living only in a component.
 */
function publicUrlFor(domain: string): { href: string; live: boolean } {
  const looksRoutable = domain.includes('.') && !/^(localhost|127\.|0\.0\.0\.0)/.test(domain)
  return looksRoutable
    ? { href: `https://${domain}`, live: true }
    : { href: `/s/${domain}/`, live: false }
}

describe('publicUrlFor', () => {
  it('links a real-looking domain straight out', () => {
    expect(publicUrlFor('docs.example.com')).toEqual({
      href: 'https://docs.example.com',
      live: true,
    })
    expect(publicUrlFor('example.co.uk').live).toBe(true)
  })

  it('falls back to the path this instance always serves', () => {
    // a bare word cannot resolve in DNS, and the loopback names are this machine
    expect(publicUrlFor('recipes')).toEqual({ href: '/s/recipes/', live: false })
    expect(publicUrlFor('localhost').live).toBe(false)
    expect(publicUrlFor('127.0.0.1:3800').live).toBe(false)
  })
})
