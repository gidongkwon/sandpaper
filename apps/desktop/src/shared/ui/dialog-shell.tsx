import { Show, type JSX } from "solid-js";

type DialogShellProps = {
  title: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  actions?: JSX.Element;
};

export const DialogShell = (props: DialogShellProps) => {
  return (
    <>
      <div class="modal__header">{props.title}</div>
      <div class="modal__body">
        <Show when={props.description}>
          {(description) => description()}
        </Show>
        {props.children}
      </div>
      <Show when={props.actions}>
        {(actions) => <div class="modal__actions">{actions()}</div>}
      </Show>
    </>
  );
};
