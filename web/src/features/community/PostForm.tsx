"use client";
// Writing or editing a community post: an article in Markdown, or a YouTube link with an optional note.
// Staff editing someone else's post also give a reason, which the staff log keeps. The API checks everything
// again; this form only says what's wrong sooner.
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Segmented } from "@/ui/Segmented";
import { Textarea } from "@/ui/Textarea";
import { postHref } from "./posts";

type Kind = Schemas["PostKind"];

export function PostForm({
  post,
  asStaff = false,
}: {
  post?: Schemas["Post"];
  /** Editing someone else's post, with `manage_posts`. */
  asStaff?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(post?.kind ?? "article");
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [videoUrl, setVideoUrl] = useState(post?.video_url ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
      kind,
      title,
      body,
      video_url: kind === "video" ? videoUrl : null,
      reason: asStaff ? reason : null,
    };
    const result = await (
      post
        ? api.PUT("/v1/posts/{post}", {
            params: { path: { post: String(post.id) } },
            body: input,
          })
        : api.POST("/v1/posts", { body: input })
    ).catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      router.push(postHref(result.data));
      router.refresh();
    } else {
      setError(
        failureMessage(result?.error, "The post couldn't be saved. Try again."),
      );
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5">
      <Segmented
        label="Kind of post"
        options={[
          { value: "article", label: "Article" },
          { value: "video", label: "Video" },
        ]}
        value={kind}
        onChange={(value) => setKind(value as Kind)}
        className="self-start"
      />
      <Field label="Title">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          required
        />
      </Field>
      {kind === "video" && (
        <Field label="YouTube link">
          <Input
            type="url"
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            required
          />
        </Field>
      )}
      <Field
        label={kind === "video" ? "Note (optional)" : "Text"}
        hint="Markdown: **bold**, *italic*, [links](https://…), lists and headings."
      >
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={20000}
          required={kind === "article"}
          rows={12}
        />
      </Field>
      {asStaff && (
        <Field
          label="Reason, for staff only"
          hint="You're editing another player's post; the staff log records it."
        >
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            required
          />
        </Field>
      )}
      {error && <p className="text-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : post ? "Save changes" : "Publish"}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="text-text-subtle text-xs">{hint}</span>}
    </label>
  );
}
