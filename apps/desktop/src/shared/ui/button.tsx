import { splitProps, type JSX } from "solid-js";

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
};

export const Button = (props: ButtonProps) => {
  const [local, rest] = splitProps(props, ["class", "label", "title", "type"]);
  return (
    <button
      class={local.class}
      type={local.type ?? "button"}
      title={local.title}
      aria-label={local.label ?? local.title}
      {...rest}
    >
      {props.children}
    </button>
  );
};
