"use client";
// A map's banner: its cover, cropped to the strip staff chose. Clicking it shows all the map's pictures whole,
// in a Lightbox. Staff controls for the Manage view come in as `children`, laid over it.
import { Images } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Schemas } from "@/api/client";
import { Lightbox } from "@/ui/Lightbox";
import { MapImage } from "./MapImage";

export function MapBanner({
  map,
  images,
  children,
}: {
  map: string;
  /** In order; the first is the cover. */
  images: Schemas["MapImage"][];
  children?: ReactNode;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const cover = images[0];

  return (
    <div className="relative">
      {cover ? (
        <button
          type="button"
          onClick={() => setShown(0)}
          aria-label={
            images.length > 1
              ? `View the ${images.length} pictures of ${map}`
              : `View the picture of ${map}`
          }
          className="block w-full cursor-zoom-in rounded-lg"
        >
          <MapImage image={cover} size="banner" />
        </button>
      ) : (
        <MapImage image={null} size="banner" />
      )}
      {images.length > 1 && (
        <span className="bg-bg/80 text-text pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs tabular-nums">
          <Images aria-hidden className="size-3.5" />
          {images.length}
        </span>
      )}
      {children}
      <Lightbox
        label={`Pictures of ${map}`}
        images={images.map((image) => ({
          url: image.url,
          thumbnailUrl: image.thumbnail_url,
        }))}
        index={shown}
        onIndex={setShown}
      />
    </div>
  );
}
