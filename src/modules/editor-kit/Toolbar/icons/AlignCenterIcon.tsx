import type { IconProps } from "./IconProps";

export default function AlignCenterIcon({ className, style, strokeWidth = 2 }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d="M8 6h8M6 10h12M8 14h8M6 18h12" />
    </svg>
  );
}
