import type { IconProps } from "./IconProps";

export default function AlignLeftIcon({ className, style, strokeWidth = 2 }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M6 6h8m-8 4h12M6 14h8m-8 4h12" />
    </svg>
  );
}
