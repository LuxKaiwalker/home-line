// L12 (D111): the loading screen controller (story/loading.ts) without a browser: a minimal document.
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetLoadingForTests, introPlaying, introSkipRequested, isFullscreenKey, keepsIntro, loadingActive, loadingDone, loadProgress, onIntroSkip, setLoadProgress, skipIntro, STAGE, STILL_LOADING_S, whenIntroStarted } from './loading'

function fakeDom() {
  const attrs: Record<string, string> = {}
  const props: Record<string, string> = {}
  let removed = false
  const root = {
    style: { setProperty: (k: string, v: string) => void (props[k] = v) },
    querySelector: (s: string) => (s === '[role=progressbar]' ? { setAttribute: (k: string, v: string) => void (attrs[k] = v) } : null),
    remove: () => void (removed = true),
  }
  const html = { dataset: {} as Record<string, string> }
  vi.stubGlobal('document', { documentElement: html, getElementById: (id: string) => (id === 'hl-loading' && !removed ? root : null) })
  return { attrs, props, html, removed: () => removed }
}

describe('intro loading screen (L12)', () => {
  beforeEach(() => _resetLoadingForTests())
  afterEach(() => vi.unstubAllGlobals())

  it('the progress bar only moves forward and reports 0..100', () => {
    const d = fakeDom()
    setLoadProgress(STAGE.map)
    setLoadProgress(STAGE.app) // an earlier stage never moves it back
    expect(loadProgress()).toBe(STAGE.map)
    expect(d.props['--hl-load-p']).toBe(String(STAGE.map))
    expect(d.attrs['aria-valuenow']).toBe(String(Math.round(STAGE.map * 100)))
    setLoadProgress(7)
    expect(loadProgress()).toBe(1)
  })

  it('the stages are in load order and end below 1 (1 = the clock started)', () => {
    const v = [STAGE.app, STAGE.view, STAGE.built, STAGE.map, STAGE.warm, STAGE.frame0]
    expect([...v].sort((a, b) => a - b)).toEqual(v)
    expect(v[v.length - 1]).toBeLessThan(1)
  })

  it('playing fades it (bar full), done removes it; whenIntroStarted resolves at the start', async () => {
    const d = fakeDom()
    expect(loadingActive()).toBe(true)
    let started = false
    void whenIntroStarted().then(() => (started = true))
    await Promise.resolve()
    expect(started).toBe(false)
    introPlaying()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toBe(true)
    expect(d.html.dataset.hlIntro).toBe('playing')
    expect(loadProgress()).toBe(1)
    loadingDone()
    expect(d.removed()).toBe(true)
    expect(d.html.dataset.hlIntro).toBeUndefined()
    expect(loadingActive()).toBe(false)
  })

  it('without a loading screen nothing waits for the intro', async () => {
    vi.stubGlobal('document', { documentElement: { dataset: {} }, getElementById: () => null })
    await expect(whenIntroStarted()).resolves.toBeUndefined()
  })

  it('skip tells every listener once (also late ones) and removes the screen', () => {
    const d = fakeDom()
    const a = vi.fn()
    onIntroSkip(a)
    skipIntro()
    skipIntro()
    expect(a).toHaveBeenCalledTimes(1)
    expect(introSkipRequested()).toBe(true)
    expect(d.removed()).toBe(true)
    const late = vi.fn()
    onIntroSkip(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('F (no modifiers, outside text fields) is the Full screen key; it and the intro controls never skip', () => {
    fakeDom()
    const k = (key: string, o: Partial<KeyboardEvent> = {}, target: unknown = null) => ({ type: 'keydown', key, ctrlKey: false, metaKey: false, altKey: false, target, ...o }) as unknown as KeyboardEvent
    expect(isFullscreenKey(k('f'))).toBe(true)
    expect(isFullscreenKey(k('F'))).toBe(true)
    expect(isFullscreenKey(k('f', { ctrlKey: true }))).toBe(false)
    expect(isFullscreenKey(k('g'))).toBe(false)
    expect(isFullscreenKey(k('f', {}, { closest: (s: string) => (s.includes('input') ? {} : null) }))).toBe(false)
    expect(keepsIntro(k('f'))).toBe(true)
    expect(keepsIntro(k('x'))).toBe(false)
    const inCtl = { type: 'pointerdown', target: { closest: (s: string) => (s === '[data-hl-intro-keep]' ? {} : null) } } as unknown as Event
    const onMap = { type: 'pointerdown', target: { closest: () => null } } as unknown as Event
    expect(keepsIntro(inCtl)).toBe(true)
    expect(keepsIntro(onMap)).toBe(false)
    loadingDone()
    expect(keepsIntro(k('f'))).toBe(false) // after the intro, F is the shell's focus mode again
  })

  it('the still-loading delay comes from config/design.yaml intro.still_loading_s', () => {
    const yaml = readFileSync(new URL('../../../config/design.yaml', import.meta.url), 'utf8')
    expect(yaml).toMatch(/still_loading_s: 15\b/)
    expect(STILL_LOADING_S).toBe(15)
  })

  it('index.html carries the screen inline, styled by the render-blocking stylesheet, with a no-JS skip', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    expect(html).toMatch(/<link rel="stylesheet" href="\/src\/story\/loading.css"/)
    const i = html.indexOf('id="hl-loading"')
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(html.indexOf('<script')) // before any script
    expect(html).toMatch(/data-hl-act="skip" href="\?intro=0#\/"/)
    expect(html).toMatch(/role="progressbar"/)
    expect(html).toMatch(/data-hl-intro-keep/)
  })
})
