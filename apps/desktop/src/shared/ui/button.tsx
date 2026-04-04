import { cva, cx, type VariantProps } from "class-variance-authority";
import { splitProps, type JSX } from "solid-js";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      unstyled: "ui-button--unstyled",
      surface: "ui-button--surface",
      primary: "ui-button--primary",
      danger: "ui-button--danger",
      ghost: "ui-button--ghost"
    },
    size: {
      sm: "ui-button--sm",
      md: "ui-button--md",
      icon: "ui-button--icon"
    },
    fullWidth: {
      true: "ui-button--full-width"
    }
  },
  defaultVariants: {
    variant: "unstyled"
  }
});

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    label?: string;
  };

export const Button = (props: ButtonProps) => {
  const [local, rest] = splitProps(props, [
    "class",
    "label",
    "title",
    "type",
    "variant",
    "size",
    "fullWidth"
  ]);

  return (
    <button
      class={cx(
        buttonVariants({
          variant: local.variant,
          size: local.size,
          fullWidth: local.fullWidth
        }),
        local.class
      )}
      type={local.type ?? "button"}
      title={local.title}
      aria-label={local.label ?? local.title}
      {...rest}
    >
      {props.children}
    </button>
  );
};
