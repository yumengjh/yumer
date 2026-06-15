import type { IconProps } from "./IconProps";

export default function ItalicIcon({ className, style }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <g transform="translate(2 2) scale(0.625)">
        <path fill="currentColor" d="M29 0h-19.636c-0.2 0-0.364 0.164-0.364 0.364v2.909c0 0.2 0.164 0.364 0.364 0.364h8.236l-7.091 24.727h-7.373c-0.2 0-0.364 0.164-0.364 0.364v2.909c0 0.2 0.164 0.364 0.364 0.364h19.636c0.2 0 0.364-0.164 0.364-0.364v-2.909c0-0.2-0.164-0.364-0.364-0.364h-8.482l7.091-24.727h7.618c0.2 0 0.364-0.164 0.364-0.364v-2.909c0-0.2-0.164-0.364-0.364-0.364z" />
      </g>
    </svg>
  );
}
