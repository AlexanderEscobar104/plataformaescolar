function isLikelyMobileDevice() {
  if (typeof window === 'undefined') return false

  const userAgent = String(window.navigator?.userAgent || '').toLowerCase()
  const hasMobileAgent = /android|iphone|ipad|ipod|mobile|windows phone/i.test(userAgent)
  const coarsePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false
  const narrowViewport = window.innerWidth <= 820

  return hasMobileAgent || (coarsePointer && narrowViewport)
}

export { isLikelyMobileDevice }
