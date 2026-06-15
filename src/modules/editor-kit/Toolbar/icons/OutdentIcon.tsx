import type { IconProps } from "./IconProps";

export default function OutdentIcon({ className, style, strokeWidth = 2 }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M21 5H11m10 7H11m10 7H11M3 8l4 4l-4 4" />
    </svg>
  );
}
