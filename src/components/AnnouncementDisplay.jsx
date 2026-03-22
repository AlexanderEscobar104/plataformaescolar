import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DOMPurify from 'dompurify'
import {
  getAnnouncementDisplaySize,
  getAnnouncementImages,
  getAnnouncementTarget,
  getAnnouncementVideo,
  normalizeRotationSeconds,
} from '../utils/announcements'

function sanitizeAnnouncementContent(content) {
  return DOMPurify.sanitize(String(content || ''), {
    USE_PROFILES: { html: true },
  })
}

function AnnouncementDisplay({ announcement, variant = 'panel', onActivate }) {
  const navigate = useNavigate()
  const images = getAnnouncementImages(announcement)
  const video = getAnnouncementVideo(announcement)
  const target = getAnnouncementTarget(announcement)
  const displaySize = getAnnouncementDisplaySize(announcement, variant)
  const sanitizedContent = useMemo(
    () => sanitizeAnnouncementContent(announcement?.content),
    [announcement?.content],
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const rotationSeconds = normalizeRotationSeconds(announcement?.rotationSeconds)
  const hasMedia = Boolean(video?.url) || images.length > 0
  const isInteractive = variant !== 'admin' && Boolean(target?.href)

  useEffect(() => {
    setActiveIndex(0)
  }, [announcement?.id, images.length])

  useEffect(() => {
    if (images.length <= 1) return undefined

    const intervalId = window.setInterval(() => {
      setActiveIndex((previous) => (previous + 1) % images.length)
    }, rotationSeconds * 1000)

    return () => window.clearInterval(intervalId)
  }, [images.length, rotationSeconds])

  const openAnnouncementTarget = () => {
    if (!target?.href || variant === 'admin') return

    if (typeof onActivate === 'function') {
      onActivate()
    }

    if (target.type === 'internal') {
      navigate(target.href)
      return
    }

    window.open(target.href, '_blank', 'noopener,noreferrer')
  }

  const handleRootClick = (event) => {
    if (!isInteractive) return

    const interactiveElement = event.target instanceof Element
      ? event.target.closest('button, a, video, iframe')
      : null

    if (interactiveElement) return
    openAnnouncementTarget()
  }

  const handleRootKeyDown = (event) => {
    if (!isInteractive) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAnnouncementTarget()
    }
  }

  return (
    <div
      className={`announcement-display announcement-display--${variant}${isInteractive ? ' announcement-display--interactive' : ''}`}
      onClick={handleRootClick}
      onKeyDown={handleRootKeyDown}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      style={{
        '--announcement-media-width': `${displaySize.width}px`,
        '--announcement-media-height': `${displaySize.height}px`,
      }}
    >
      {video?.url && (
        <div className="announcement-video-wrap">
          {video.embedUrl ? (
            <iframe
              className="announcement-video"
              src={video.embedUrl}
              title={video.name || announcement?.title || 'Video del anuncio'}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <video
              className="announcement-video"
              src={video.url}
              controls
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="announcement-carousel">
          <div className="announcement-carousel-frame">
            <img
              src={images[activeIndex]?.url}
              alt={images[activeIndex]?.name || announcement?.title || 'Anuncio'}
            />
          </div>
          {images.length > 1 && (
            <div className="announcement-carousel-footer">
              <span>
                Imagen {activeIndex + 1} de {images.length} · {rotationSeconds}s
              </span>
              <div className="announcement-carousel-dots">
                {images.map((image, index) => (
                  <button
                    key={image.path || image.url || index}
                    type="button"
                    className={`announcement-carousel-dot${index === activeIndex ? ' active' : ''}`}
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Ver imagen ${index + 1}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {sanitizedContent && (
        <div
          className={`announcement-content${hasMedia ? ' announcement-content--with-media' : ''}`}
          dangerouslySetInnerHTML={{ __html: sanitizedContent }}
        />
      )}

      {!sanitizedContent && !hasMedia && (
        <p className="announcement-empty">Este anuncio no tiene contenido para mostrar.</p>
      )}
    </div>
  )
}

export default AnnouncementDisplay
