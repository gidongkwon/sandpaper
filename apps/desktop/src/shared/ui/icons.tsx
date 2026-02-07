import type { Component, JSX } from "solid-js";
import add12Regular from "@fluentui/svg-icons/icons/add_12_regular.svg?raw";
import add16Regular from "@fluentui/svg-icons/icons/add_16_regular.svg?raw";
import addSquareMultiple16Regular from "@fluentui/svg-icons/icons/add_square_multiple_16_regular.svg?raw";
import alert16Regular from "@fluentui/svg-icons/icons/alert_16_regular.svg?raw";
import arrowSync16Regular from "@fluentui/svg-icons/icons/arrow_sync_16_regular.svg?raw";
import arrowUpload16Regular from "@fluentui/svg-icons/icons/arrow_upload_16_regular.svg?raw";
import copy16Regular from "@fluentui/svg-icons/icons/copy_16_regular.svg?raw";
import dismiss12Regular from "@fluentui/svg-icons/icons/dismiss_12_regular.svg?raw";
import document16Regular from "@fluentui/svg-icons/icons/document_16_regular.svg?raw";
import link16Regular from "@fluentui/svg-icons/icons/link_16_regular.svg?raw";
import link20Regular from "@fluentui/svg-icons/icons/link_20_regular.svg?raw";
import lockClosed16Regular from "@fluentui/svg-icons/icons/lock_closed_16_regular.svg?raw";
import panelLeft16Regular from "@fluentui/svg-icons/icons/panel_left_16_regular.svg?raw";
import puzzlePiece16Regular from "@fluentui/svg-icons/icons/puzzle_piece_16_regular.svg?raw";
import search16Regular from "@fluentui/svg-icons/icons/search_16_regular.svg?raw";
import settings16Regular from "@fluentui/svg-icons/icons/settings_16_regular.svg?raw";
import lightbulb16Regular from "@fluentui/svg-icons/icons/lightbulb_16_regular.svg?raw";
import send20Regular from "@fluentui/svg-icons/icons/send_20_regular.svg?raw";
import shieldCheckmark16Regular from "@fluentui/svg-icons/icons/shield_checkmark_16_regular.svg?raw";

type FluentIconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

type ParsedSvgIcon = {
  body: string;
  viewBox: string;
};

const parseSvgIcon = (svgMarkup: string): ParsedSvgIcon => {
  const viewBoxMatch = svgMarkup.match(/viewBox="([^"]+)"/);
  const bodyMatch = svgMarkup.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!viewBoxMatch || !bodyMatch) {
    throw new Error("Invalid Fluent SVG icon markup.");
  }

  return {
    viewBox: viewBoxMatch[1],
    body: bodyMatch[1]
  };
};

const createFluentIcon = (svgMarkup: string): Component<FluentIconProps> => {
  const icon = parseSvgIcon(svgMarkup);

  return (props) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={icon.viewBox}
      fill="currentColor"
      aria-hidden="true"
      data-fluent-icon="true"
      {...props}
      innerHTML={icon.body}
    />
  );
};

export const Add12Icon = createFluentIcon(add12Regular);
export const Add16Icon = createFluentIcon(add16Regular);
export const AddSquareMultiple16Icon = createFluentIcon(addSquareMultiple16Regular);
export const Alert16Icon = createFluentIcon(alert16Regular);
export const ArrowSync16Icon = createFluentIcon(arrowSync16Regular);
export const ArrowUpload16Icon = createFluentIcon(arrowUpload16Regular);
export const Copy16Icon = createFluentIcon(copy16Regular);
export const Dismiss12Icon = createFluentIcon(dismiss12Regular);
export const Document16Icon = createFluentIcon(document16Regular);
export const Lightbulb16Icon = createFluentIcon(lightbulb16Regular);
export const Link16Icon = createFluentIcon(link16Regular);
export const Link20Icon = createFluentIcon(link20Regular);
export const LockClosed16Icon = createFluentIcon(lockClosed16Regular);
export const PanelLeft16Icon = createFluentIcon(panelLeft16Regular);
export const PuzzlePiece16Icon = createFluentIcon(puzzlePiece16Regular);
export const Search16Icon = createFluentIcon(search16Regular);
export const Send20Icon = createFluentIcon(send20Regular);
export const Settings16Icon = createFluentIcon(settings16Regular);
export const ShieldCheckmark16Icon = createFluentIcon(shieldCheckmark16Regular);
