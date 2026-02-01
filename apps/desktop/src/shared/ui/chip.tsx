import { splitProps, type JSX } from "solid-js";
import { Button } from "./button";

type ChipProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export const Chip = (props: ChipProps) => {
  const [local, rest] = splitProps(props, ["active", "class"]);
  return (
    <Button
      class={`chip ${local.class ?? ""}`.trim()}
      classList={{ "is-active": Boolean(local.active) }}
      {...rest}
    >
      {props.children}
    </Button>
  );
};
