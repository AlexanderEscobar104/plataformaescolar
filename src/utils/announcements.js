function normalizeRotationSeconds(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 5
  return Math.min(Math.max(Math.round(parsed), 1), 60)
}

function normalizeAnnouncementDimension(value, defaultValue, minValue, maxValue) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return defaultValue
  return Math.min(Math.max(Math.round(parsed), minValue), maxValue)
}

function getAnnouncementDisplaySize(announcement, variant = 'panel') {
  const widthBounds =
    variant === 'modal'
      ? { defaultValue: 640, minValue: 320, maxValue: 920 }
      : variant === 'admin'
        ? { defaultValue: 640, minValue: 280, maxValue: 760 }
        : { defaultValue: 640, minValue: 280, maxValue: 760 }

  const heightBounds =
    variant === 'modal'
      ? { defaultValue: 360, minValue: 180, maxValue: 620 }
      : variant === 'admin'
        ? { defaultValue: 260, minValue: 160, maxValue: 420 }
        : { defaultValue: 260, minValue: 160, maxValue: 420 }

  return {
    width: normalizeAnnouncementDimension(
      announcement?.displayWidth,
      widthBounds.defaultValue,
      widthBounds.minValue,
      widthBounds.maxValue,
    ),
    height: normalizeAnnouncementDimension(
      announcement?.displayHeight,
      heightBounds.defaultValue,
      heightBounds.minValue,
      heightBounds.maxValue,
    ),
  }
}

function getAnnouncementImages(announcement) {
  if (Array.isArray(announcement?.images)) return announcement.images
  return []
}

function normalizeAnnouncementVideoUrl(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) return ''

  try {
    const parsed = new URL(rawValue)
    return parsed.toString()
  } catch {
    return ''
  }
}

function normalizeAnnouncementExternalUrl(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) return ''

  try {
    const parsed = new URL(rawValue)
    return parsed.toString()
  } catch {
    return ''
  }
}

function buildEmbedVideoUrl(url) {
  const normalizedUrl = normalizeAnnouncementVideoUrl(url)
  if (!normalizedUrl) return ''

  try {
    const parsed = new URL(normalizedUrl)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      const videoId =
        host === 'youtu.be'
          ? parsed.pathname.split('/').filter(Boolean)[0]
          : parsed.searchParams.get('v')

      if (!videoId) return ''
      return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0`
    }

    if (host === 'vimeo.com') {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0]
      if (!videoId) return ''
      return `https://player.vimeo.com/video/${videoId}?autoplay=1&muted=1`
    }
  } catch {
    return ''
  }

  return ''
}

function getAnnouncementVideo(announcement) {
  const videoFromObject =
    announcement?.video && typeof announcement.video === 'object' ? announcement.video : null
  const normalizedVideoUrl = normalizeAnnouncementVideoUrl(
    videoFromObject?.url || announcement?.videoUrl || '',
  )

  if (!normalizedVideoUrl) return videoFromObject

  const embedUrl = buildEmbedVideoUrl(normalizedVideoUrl)

  return {
    ...(videoFromObject || {}),
    name: videoFromObject?.name || announcement?.title || 'Video del anuncio',
    url: normalizedVideoUrl,
    source: embedUrl ? 'embed' : videoFromObject?.source || 'external',
    embedUrl: embedUrl || '',
    type: videoFromObject?.type || '',
  }
}

function getAnnouncementTarget(announcement) {
  const linkType = String(announcement?.linkType || 'none')

  if (linkType === 'internal') {
    const internalPath = String(announcement?.internalLink || '').trim()
    if (!internalPath.startsWith('/')) return null

    return {
      type: 'internal',
      href: internalPath,
    }
  }

  if (linkType === 'external') {
    const externalUrl = normalizeAnnouncementExternalUrl(announcement?.externalLink || '')
    if (!externalUrl) return null

    return {
      type: 'external',
      href: externalUrl,
    }
  }

  return null
}

function shouldShowAnnouncementOnHome(announcement) {
  if (announcement?.showOnHome === true) return true
  if (announcement?.showOnHome === false) return false
  return !announcement?.showAsModal
}

function buildAnnouncementStudentSubgroupKey(gradeValue, groupValue) {
  const grade = String(gradeValue || '').trim().toUpperCase()
  const group = String(groupValue || '').trim().toUpperCase()
  if (!grade || !group) return ''
  return `${grade}::${group}`
}

function matchesAnnouncementAudience(announcement, viewer = {}) {
  const role = String(viewer?.role || '').trim().toLowerCase()
  const targetRoles = Array.isArray(announcement?.targetRoles)
    ? announcement.targetRoles.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : []

  if (targetRoles.length > 0 && !targetRoles.includes(role)) {
    return false
  }

  if (role === 'estudiante') {
    const targetStudentSubgroups = Array.isArray(announcement?.targetStudentSubgroups)
      ? announcement.targetStudentSubgroups.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
      : []

    if (targetStudentSubgroups.length > 0) {
      const viewerSubgroupKey = buildAnnouncementStudentSubgroupKey(viewer?.grade, viewer?.group)
      if (!viewerSubgroupKey || !targetStudentSubgroups.includes(viewerSubgroupKey)) {
        return false
      }
    }
  }

  return true
}

export {
  getAnnouncementDisplaySize,
  buildEmbedVideoUrl,
  buildAnnouncementStudentSubgroupKey,
  getAnnouncementImages,
  getAnnouncementTarget,
  getAnnouncementVideo,
  matchesAnnouncementAudience,
  normalizeAnnouncementVideoUrl,
  normalizeAnnouncementExternalUrl,
  normalizeAnnouncementDimension,
  normalizeRotationSeconds,
  shouldShowAnnouncementOnHome,
}
