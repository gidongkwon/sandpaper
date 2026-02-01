import type { JSX } from "solid-js";
import { Button } from "./button";

type IconButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
};

export const IconButton = (props: IconButtonProps) => {
  return <Button {...props} />;
};
