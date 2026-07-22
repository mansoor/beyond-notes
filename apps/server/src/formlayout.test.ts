import {
  FORM_MAX_COLUMNS,
  clampFormColumns,
  formWidthChoices,
  normalizeFormLayout,
  normalizeFormOrder,
  placeFormField,
} from '@bn/schema'
import { describe, expect, it } from 'vitest'

// The rule the whole feature rests on: a field starts in a column and spans
// rightwards, so how wide it may be depends on where it starts. Lives in
// @bn/schema because the browser's dropdowns and the server's saved config
// have to agree exactly — two implementations would drift.

describe('formWidthChoices', () => {
  it('offers only the widths that fit from the chosen column', () => {
    expect(formWidthChoices(1, 1)).toEqual([1])
    expect(formWidthChoices(1, 2)).toEqual([1, 2])
    // the user's contacts example: column 2 of 2 can only ever be one wide
    expect(formWidthChoices(2, 2)).toEqual([1])
    expect(formWidthChoices(1, 3)).toEqual([1, 2, 3])
    expect(formWidthChoices(2, 3)).toEqual([1, 2])
    expect(formWidthChoices(3, 3)).toEqual([1])
  })

  it('never returns an empty list, whatever nonsense it is handed', () => {
    for (const [col, cols] of [
      [0, 2],
      [9, 2],
      [-1, 1],
      [1, 99],
    ]) {
      expect(formWidthChoices(col as number, cols as number).length).toBeGreaterThan(0)
    }
  })
})

describe('placeFormField', () => {
  it('defaults a missing placement to the first column, one wide', () => {
    expect(placeFormField(undefined, 3)).toEqual({ col: 1, width: 1 })
    expect(placeFormField({}, 2)).toEqual({ col: 1, width: 1 })
  })

  it('pulls a field back inside the grid instead of letting it overflow', () => {
    // asked for column 3 in a 2-column form
    expect(placeFormField({ col: 3, width: 1 }, 2)).toEqual({ col: 2, width: 1 })
    // asked to span 3 starting at column 2 of 3 — only 2 columns remain
    expect(placeFormField({ col: 2, width: 3 }, 3)).toEqual({ col: 2, width: 2 })
    // a single-column form flattens everything
    expect(placeFormField({ col: 2, width: 2 }, 1)).toEqual({ col: 1, width: 1 })
  })

  it('survives junk values without producing NaN', () => {
    expect(placeFormField({ col: 0, width: 0 }, 2)).toEqual({ col: 1, width: 1 })
    expect(placeFormField({ col: Number.NaN, width: Number.NaN }, 2)).toEqual({ col: 1, width: 1 })
    expect(placeFormField({ col: 1.6, width: 2.4 }, 3)).toEqual({ col: 2, width: 2 })
  })
})

describe('clampFormColumns', () => {
  it('keeps the grid between one column and the cap', () => {
    expect(clampFormColumns(undefined)).toBe(1)
    expect(clampFormColumns(0)).toBe(1)
    expect(clampFormColumns(2)).toBe(2)
    expect(clampFormColumns(99)).toBe(FORM_MAX_COLUMNS)
  })
})

describe('normalizeFormOrder', () => {
  it('keeps the saved order and appends anything it does not mention', () => {
    // a column ticked after the order was saved still has to appear
    expect(normalizeFormOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b'])
  })

  it('drops ids that no longer exist — a deleted column, a removed block', () => {
    expect(normalizeFormOrder(['a', 'b'], ['gone', 'b', 'a'])).toEqual(['b', 'a'])
  })

  it('survives duplicates and a missing order', () => {
    expect(normalizeFormOrder(['a', 'b'], ['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeFormOrder(['a', 'b'], undefined)).toEqual(['a', 'b'])
    expect(normalizeFormOrder([], ['a'])).toEqual([])
  })

  it('keeps a divider between the fields it was put between', () => {
    // the whole point of a block: its position relative to the fields is the
    // only thing it has
    expect(
      normalizeFormOrder(['name', 'email', 'blk_1', 'city'], ['name', 'blk_1', 'email']),
    ).toEqual(['name', 'blk_1', 'email', 'city'])
  })
})

describe('normalizeFormLayout', () => {
  it('places exactly the fields on the form — no more, no fewer', () => {
    const layout = normalizeFormLayout(['a', 'b'], 2, {
      a: { col: 1, width: 2 },
      // 'gone' left the form; its placement must not survive
      gone: { col: 2, width: 1 },
    })
    expect(Object.keys(layout).sort()).toEqual(['a', 'b'])
    expect(layout.a).toEqual({ col: 1, width: 2 })
    expect(layout.b).toEqual({ col: 1, width: 1 })
  })

  it('refits every field when the grid narrows', () => {
    const wide = { a: { col: 3, width: 1 }, b: { col: 1, width: 3 } }
    expect(normalizeFormLayout(['a', 'b'], 2, wide)).toEqual({
      a: { col: 2, width: 1 },
      b: { col: 1, width: 2 },
    })
  })

  it('reads a form saved before layouts existed as a plain single column', () => {
    expect(normalizeFormLayout(['a', 'b'], undefined, undefined)).toEqual({
      a: { col: 1, width: 1 },
      b: { col: 1, width: 1 },
    })
  })

  it('lays out the contacts example the way it was asked for', () => {
    const fields = ['name', 'email', 'phone', 'address', 'city', 'country', 'zip', 'message']
    const layout = normalizeFormLayout(fields, 2, {
      name: { col: 1, width: 1 },
      email: { col: 1, width: 1 },
      phone: { col: 2, width: 1 },
      address: { col: 1, width: 1 },
      city: { col: 2, width: 1 },
      country: { col: 1, width: 1 },
      zip: { col: 2, width: 1 },
      message: { col: 1, width: 2 },
    })
    expect(layout.message).toEqual({ col: 1, width: 2 })
    expect(layout.zip).toEqual({ col: 2, width: 1 })
    // nothing was clamped: every placement fits a 2-column grid as given
    expect(Object.values(layout).every((p) => p.col + p.width <= 3)).toBe(true)
  })
})
