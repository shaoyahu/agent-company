/**
 * useViewport — 三档视口断点 hook
 *
 * 用途:每个 view 拿 `vp.isNarrow / isMedium / shouldCollapseChat` 决定布局。
 * 用 matchMedia 而非 window.innerWidth,避开 React 18 strict mode 双 mount
 * 时 innerWidth 还未 layout 完成的竞态。
 *
 * 断点:
 *   narrow  (<900px)   极窄屏(手机竖屏 / 窗口很窄) — 1 列 / 紧凑 / chat 折叠
 *   medium  (<1200px)  中等屏(笔记本 13 寸) — 2 列 / chat 折叠
 *   wide    (>=1200px) 宽屏(外接显示器) — 完整布局
 *
 * 例:
 *   const vp = useViewport();
 *   gridTemplateColumns: vp.isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))'
 */

import { useEffect, useState } from 'react';

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    setMatches(mq.matches); // mount 后立刻同步当前值
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

export interface ViewportInfo {
  width: number;
  isNarrow: boolean;     // <900px
  isMedium: boolean;     // <1200px
  shouldCollapseChat: boolean; // <1200px(中等以下 chat 折叠,把空间让给主区)
}

export function useViewport(): ViewportInfo {
  const isNarrow = useMatchMedia('(max-width: 899px)');
  const isMedium = useMatchMedia('(max-width: 1199px)');
  // 估算宽度(供 debug / 条件渲染用)— 不需要精确,够用
  const [width, setWidth] = useState<number>(1440);
  useEffect(() => {
    const sync = () => setWidth(window.innerWidth);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return {
    width,
    isNarrow,
    isMedium,
    shouldCollapseChat: isMedium,
  };
}
