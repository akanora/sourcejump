// Uploads a packed map as its viewer file: the API gives a link into private storage, the bytes go there
// directly (Cloudflare refuses request bodies over 100 MB on the way to the API), then the API checks them.
import { api, failureMessage } from "@/api/client";

export async function uploadViewerFile(
  map: string,
  packed: Blob | ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const link = await api
    .POST("/v1/staff/maps/{map}/viewer-file/uploads", {
      params: { path: { map } },
    })
    .catch(() => undefined);
  if (!link?.data) {
    return {
      ok: false,
      message: failureMessage(
        link?.error,
        "The upload couldn't start. Try again.",
      ),
    };
  }
  if (!(await put(link.data.upload_url, packed, onProgress))) {
    return {
      ok: false,
      message: "The packed map couldn't be uploaded. Try again.",
    };
  }
  const stored = await api
    .PUT("/v1/staff/maps/{map}/viewer-file", {
      params: { path: { map } },
      body: { upload: link.data.upload },
    })
    .catch(() => undefined);
  if (!stored?.response.ok) {
    return {
      ok: false,
      message: failureMessage(
        stored?.error,
        "The uploaded map couldn't be checked. Try again.",
      ),
    };
  }
  return { ok: true };
}

/** Sends `body` to the presigned link, without credentials. XMLHttpRequest, since fetch can't report upload
 * progress, and large maps take minutes on a slow connection. */
function put(
  url: string,
  body: Blob | ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };
    request.onload = () =>
      resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.send(body);
  });
}
