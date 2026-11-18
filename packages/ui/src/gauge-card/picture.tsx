import type { CSSProperties, ReactNode } from "react"
import * as Avatar from "../avatar"

/**
 * Gauge pictures are fixed per gauge across products (matchbox-v3): the
 * profile image as a rounded square, or initials on a pastel circle when a
 * gauge has no profile. Its own module so rows and marks that only show a
 * picture do not load the whole card.
 */

export type Picture =
  | { kind: "image"; url: string }
  | { kind: "initials"; initials: string; hue: number }

export type PictureProps = {
  picture: Picture
  /** 52 on cards, 36 in the ballot, 48 in rows, 18 in allocation marks. */
  size?: number
  /** Shared-element view transition name (card to profile). */
  transitionName?: string
  /** The page's largest image (a profile header): fetch it first. */
  priority?: boolean
  /**
   * Draw the picture at this smaller size underneath until the full one
   * has loaded. The profile passes the card's size (52) when it opens from
   * a list: that file is already in the browser's cache, so the picture
   * shows at once (through the view transition too) instead of leaving a
   * blank square while the larger file downloads.
   */
  placeholderSize?: number
  className?: string
}

const storedObject = "/storage/v1/object/public/"
const renderedImage = "/storage/v1/render/image/public/"

/**
 * A gauge picture at the size it is drawn. Owners upload whatever they
 * have (1300 by 1300 is common) and a row shows it at 52: Vote's first
 * load fetched 276 kB of pictures. Supabase Storage resizes on request, so
 * a picture stored there is asked for at `pixels` square instead (a 22 kB
 * logo comes back under 4 kB). Any other URL is returned as it is.
 */
export function sizedPictureUrl(url: string, pixels: number): string {
  const at = url.indexOf(storedObject)
  if (at === -1 || url.includes("?")) return url
  const side = Math.max(16, Math.round(pixels))
  return `${url.slice(0, at)}${renderedImage}${url.slice(at + storedObject.length)}?width=${side}&height=${side}&resize=cover`
}

export function GaugePicture({
  picture,
  size = 52,
  transitionName,
  priority = false,
  placeholderSize,
  className,
}: PictureProps): ReactNode {
  const style: CSSProperties = {
    width: size,
    height: size,
    ...(transitionName === undefined
      ? {}
      : { viewTransitionName: transitionName }),
  }
  if (picture.kind === "initials") {
    return (
      <span className={`flex-none ${className ?? ""}`} style={style}>
        <Avatar.Root
          initials={picture.initials}
          hue={picture.hue}
          size={size}
        />
      </span>
    )
  }
  // One and two device pixels per CSS pixel; phones pick the second.
  const once = sizedPictureUrl(picture.url, size)
  const twice = sizedPictureUrl(picture.url, size * 2)
  const radius = Math.round(size * 0.29)
  const image = (
    <img
      src={once}
      {...(twice === once ? {} : { srcSet: `${once} 1x, ${twice} 2x` })}
      alt=""
      width={size}
      height={size}
      // Rows below the fold wait until they are near the screen.
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      className={`block flex-none object-cover ${placeholderSize === undefined ? (className ?? "") : "relative"}`}
      style={
        placeholderSize === undefined
          ? { ...style, borderRadius: radius }
          : { width: size, height: size, borderRadius: radius }
      }
    />
  )
  if (placeholderSize === undefined) return image
  const small = sizedPictureUrl(picture.url, placeholderSize)
  const smallTwice = sizedPictureUrl(picture.url, placeholderSize * 2)
  // The same URLs the card asked for, so the browser picks the copy it
  // already holds. The full picture paints over it once it arrives (an
  // image that has not loaded paints nothing).
  return (
    <span
      data-picture-placeholder=""
      className={`relative block flex-none overflow-hidden ${className ?? ""}`}
      style={{ ...style, borderRadius: radius }}
    >
      <img
        src={small}
        {...(smallTwice === small
          ? {}
          : { srcSet: `${small} 1x, ${smallTwice} 2x` })}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="eager"
        decoding="sync"
        fetchPriority="low"
        className="absolute inset-0 block size-full object-cover"
      />
      {image}
    </span>
  )
}

GaugePicture.displayName = "GaugeCard.Picture"
