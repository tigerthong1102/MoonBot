import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { avatarMarks } from "@/lib/avatar-marks";
import { usePrefersReducedMotion } from "../mascot-clock";
import type { MausAvatarHandle, MausAvatarProps } from "../Avatar";

export const StartupBotAvatar = forwardRef<MausAvatarHandle, MausAvatarProps>(function StartupBotAvatar(
  { size = 44, label, state = "idle", animated = true, motion = "none", motionKey = 0, color, kind }, ref,
) {
  const image = useRef<HTMLImageElement>(null);
  const animation = useRef<Animation | null>(null);
  const reduced = usePrefersReducedMotion();
  const live = animated && !reduced;
  const play = (frames: Keyframe[], duration: number) => {
    animation.current?.cancel();
    if (live) animation.current = image.current?.animate?.(frames, { duration, easing: "ease-out" }) ?? null;
  };
  useImperativeHandle(ref, () => ({
    blink: () => play([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], 180),
    spin: (duration = 280) => play([{ transform: "rotate(-12deg)" }, { transform: "rotate(0)" }], Math.min(300, duration)),
    setExpression: expression => { if (image.current) image.current.dataset.expression = String(expression); },
  }));
  useEffect(() => {
    if (motion !== "none" && live) animation.current = image.current?.animate?.([{ transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: 180, easing: "ease-out" }) ?? null;
    return () => { animation.current?.cancel(); };
  }, [motion, motionKey, live]);
  return (
    <span {...avatarMarks(kind, "picture")} data-startupbot-avatar="" data-avatar-state={state} data-avatar-color={color}
      className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <img ref={image} src="/startupbot-icon-192.png" alt={label ?? ""} width={size} height={size} draggable={false}
        className="block size-full object-contain" />
    </span>
  );
});
