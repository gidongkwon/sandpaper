import { cva, cx, type VariantProps } from "class-variance-authority";
import { Button, type ButtonProps } from "./button";

export const iconButtonVariants = cva("ui-icon-button", {
  variants: {
    variant: {
      default: "ui-icon-button--default",
      toolbar: "ui-icon-button--toolbar",
      sidebar: "ui-icon-button--sidebar",
      panel: "ui-icon-button--panel",
      block: "ui-icon-button--block",
      inline: "ui-icon-button--inline"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

type IconButtonProps = Omit<ButtonProps, "size" | "variant"> &
  VariantProps<typeof iconButtonVariants>;

export const IconButton = (props: IconButtonProps) => {
  return (
    <Button
      {...props}
      variant="unstyled"
      class={cx(iconButtonVariants({ variant: props.variant }), props.class)}
    />
  );
};
