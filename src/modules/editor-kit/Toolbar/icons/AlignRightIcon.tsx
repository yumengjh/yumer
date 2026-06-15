import type { IconProps } from "./IconProps";

export default function AlignRightIcon({ className, style, strokeWidth = 2 }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M18 6h-8m8 4H6m12 4h-8m8 4H6" />
    </svg>
  );
}
