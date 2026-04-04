import { Button, type ButtonProps } from "./button";

type IconButtonProps = ButtonProps;

export const IconButton = (props: IconButtonProps) => {
  return <Button {...props} />;
};
