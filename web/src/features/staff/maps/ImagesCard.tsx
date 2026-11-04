"use client";
// A map's pictures on its Manage view, for staff who hold manage_maps: up to 10 in order, the first being the
// cover. Add images takes several files at once and uploads them one by one; the API crops, resizes and
// compresses each. Arrows reorder, Make cover moves one to the front, and Remove asks first.
import { ChevronLeft, ChevronRight, ImageUp, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState } from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { useStaffAction } from "../useStaffAction";

const MAX_IMAGES = 10;
/** The API's limit; checked here too, so a big file fails before it's sent. */
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

type Image = Schemas["MapImage"];

export function ImagesCard({ map, images }: { map: string; images: Image[] }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Image | null>(null);
  const action = useStaffAction();
  const room = MAX_IMAGES - images.length;

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    const found: string[] = [];
    if (files.length > room) {
      found.push(
        `Only ${room} more ${room === 1 ? "fits" : "fit"}; the rest weren't added.`,
      );
    }
    const chosen = files.slice(0, room);
    for (const [index, file] of chosen.entries()) {
      setUploading(`Uploading ${index + 1} of ${chosen.length}…`);
      if (!TYPES.includes(file.type)) {
        found.push(`${file.name}: choose a PNG, JPEG or WebP image.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        found.push(`${file.name}: the image is over 15 MB.`);
        continue;
      }
      const result = await api
        .POST("/v1/staff/maps/{map}/images", {
          params: { path: { map } },
          // The schema types a binary body as a string; the file itself is what's sent.
          body: file as unknown as string,
          bodySerializer: (body) => body as unknown as BodyInit,
          headers: { "content-type": file.type },
        })
        .catch(() => undefined);
      if (!result?.response.ok) {
        found.push(
          `${file.name}: ${failureMessage(result?.error, "it couldn't be uploaded. Try again.")}`,
        );
      }
    }
    setUploading(null);
    setProblems(found);
    router.refresh();
  }

  function reorder(order: Image[]) {
    void action.run(
      () =>
        api.PUT("/v1/staff/maps/{map}/images/order", {
          params: { path: { map } },
          body: { images: order.map((image) => image.id) },
        }),
      "The pictures couldn't be reordered. Try again.",
    );
  }

  function move(index: number, by: number) {
    const order = [...images];
    const [image] = order.splice(index, 1);
    if (!image) return;
    order.splice(index + by, 0, image);
    reorder(order);
  }

  async function remove() {
    if (!removing) return;
    const done = await action.run(
      () =>
        api.DELETE("/v1/staff/maps/{map}/images/{id}", {
          params: { path: { map, id: removing.id } },
        }),
      "The picture couldn't be removed. Try again.",
    );
    if (done) setRemoving(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-text-muted text-sm tabular-nums">
          {images.length} of {MAX_IMAGES}
        </span>
        <Button
          size="sm"
          onClick={() => input.current?.click()}
          disabled={room === 0 || uploading !== null}
        >
          <ImageUp aria-hidden />
          {uploading ?? "Add images"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={TYPES.join(",")}
          onChange={add}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose images"
        />
      </div>
      {problems.length > 0 && (
        <ul className="text-danger flex flex-col gap-0.5 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {action.error && !removing && (
        <p className="text-danger text-sm">{action.error}</p>
      )}
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image, index) => (
            <li key={image.id} className="motion-enter flex flex-col gap-1.5">
              <div className="border-border relative overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbnail_url}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
                {index === 0 && (
                  <Badge tone="accent" className="absolute top-1.5 left-1.5">
                    Cover
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="flex">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move earlier"
                    disabled={index === 0 || action.busy}
                    onClick={() => move(index, -1)}
                    className="px-1.5"
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move later"
                    disabled={index === images.length - 1 || action.busy}
                    onClick={() => move(index, 1)}
                    className="px-1.5"
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </span>
                <span className="flex">
                  {index > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Make cover"
                      title="Make cover"
                      disabled={action.busy}
                      onClick={() => move(index, -index)}
                      className="px-1.5"
                    >
                      <Star aria-hidden />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove"
                    title="Remove"
                    onClick={() => setRemoving(image)}
                    className="px-1.5"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          action.clearError();
        }}
        title="Remove this picture?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={remove} disabled={action.busy}>
              {action.busy ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {removing && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={removing.thumbnail_url}
              alt=""
              className="border-border aspect-video w-full rounded-md border object-cover"
            />
          )}
          <p className="text-text-muted text-sm">
            {removing === images[0]
              ? "It's the cover; the next picture becomes the cover."
              : "It leaves the map's pictures for good."}
          </p>
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
