import { cva, cx, type VariantProps } from "class-variance-authority";
import { splitProps, type JSX } from "solid-js";

export const textFieldVariants = cva("ui-input", {
  variants: {
    size: {
      sm: "ui-input--sm",
      md: "ui-input--md"
    },
    font: {
      body: "ui-input--body",
      mono: "ui-input--mono"
    }
  },
  defaultVariants: {
    size: "md",
    font: "body"
  }
});

export type TextFieldProps = JSX.InputHTMLAttributes<HTMLInputElement> &
  VariantProps<typeof textFieldVariants>;

export const TextField = (props: TextFieldProps) => {
  const [local, rest] = splitProps(props, ["class", "size", "font"]);

  return (
    <input
      class={cx(
        textFieldVariants({
          size: local.size,
          font: local.font
        }),
        local.class
      )}
      {...rest}
    />
  );
};
