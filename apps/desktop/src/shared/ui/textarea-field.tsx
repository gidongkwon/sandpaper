import { cva, cx, type VariantProps } from "class-variance-authority";
import { splitProps, type JSX } from "solid-js";

export const textareaFieldVariants = cva("ui-textarea", {
  variants: {
    font: {
      body: "ui-textarea--body",
      mono: "ui-textarea--mono"
    }
  },
  defaultVariants: {
    font: "body"
  }
});

export type TextareaFieldProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> &
  VariantProps<typeof textareaFieldVariants>;

export const TextareaField = (props: TextareaFieldProps) => {
  const [local, rest] = splitProps(props, ["class", "font"]);

  return (
    <textarea
      class={cx(textareaFieldVariants({ font: local.font }), local.class)}
      {...rest}
    />
  );
};
