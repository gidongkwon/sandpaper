import { splitProps, type JSX } from "solid-js";

type EmptyStateProps = JSX.HTMLAttributes<HTMLDivElement> & {
  message?: string;
};

export const EmptyState = (props: EmptyStateProps) => {
  const [local, rest] = splitProps(props, ["class", "message", "children"]);
  return (
    <div class={local.class} role="status" aria-live="polite" {...rest}>
      {local.message ?? local.children}
    </div>
  );
};
