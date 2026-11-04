// Long-form text as HTML, e.g. a community post's body, with the design system's type for each element.
import { classNames } from "./classNames";

/**
 * Only for HTML the API has already made safe (a post's `body_html`, from `posts/markdown.rs`): it's
 * inserted as is. Never pass text from anywhere else.
 */
export function Prose({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={classNames(
        "text-text max-w-prose leading-relaxed",
        "[&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-bold [&>*+*]:mt-4 [&>:first-child]:mt-0",
        "[&_h4]:mt-6 [&_h4]:font-bold [&_h5]:font-bold [&_h6]:font-bold",
        "[&_a]:text-accent [&_a]:underline-offset-4 [&_a:hover]:underline",
        "[&_li+li]:mt-1 [&_ol]:list-decimal [&_ul]:list-disc [&_ul,&_ol]:pl-6",
        "[&_blockquote]:border-border-strong [&_blockquote]:text-text-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
        "[&_code]:bg-surface-raised [&_code]:rounded-sm [&_code]:px-1 [&_code]:text-sm",
        "[&_pre]:bg-surface-raised [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_hr]:border-border",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
