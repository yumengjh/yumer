import type { IconProps } from "./IconProps";

export default function BoldIcon({ className, style }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <g transform="translate(2 2) scale(0.625)">
        <path fill="currentColor" d="M24.078 14.67c1.461-1.522 2.357-3.578 2.357-5.839v-0.443c0-4.678-3.83-8.474-8.552-8.474h-12.865c-0.657 0-1.191 0.535-1.191 1.191v29.526c0 0.709 0.574 1.283 1.283 1.283h13.857c5.087 0 9.209-4.096 9.209-9.152v-0.478c0-3.174-1.626-5.97-4.096-7.613zM8 4.087h9.77c2.483 0 4.491 1.93 4.491 4.317v0.413c0 2.383-2.013 4.317-4.491 4.317h-9.77v-9.048zM23.939 22.757c0 2.735-2.248 4.952-5.022 4.952h-10.917v-10.374h10.917c2.774 0 5.022 2.217 5.022 4.952v0.47z" />
      </g>
    </svg>
  );
}
