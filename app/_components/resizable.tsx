'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

type Side = 'left' | 'right'

// 패널 폭을 드래그로 조절하고 localStorage에 저장하는 훅.
//  side='left'  : 패널이 왼쪽(사이드바) → 핸들을 오른쪽으로 끌면 넓어짐
//  side='right' : 패널이 오른쪽(초안)   → 핸들을 왼쪽으로 끌면 넓어짐
// 하이드레이션 안전: 서버/첫 렌더는 initial, 마운트 후 저장값을 반영(레이아웃 1프레임 보정).
export function usePanelResize(
  storageKey: string,
  opts: { initial: number; min: number; max: number; side: Side },
) {
  const { initial, min, max, side } = opts
  const [width, setWidth] = useState(initial)
  const drag = useRef({ startX: 0, startW: initial, active: false })

  useEffect(() => {
    // localStorage는 클라이언트 전용이라 useState 초기값에 넣으면 SSR 하이드레이션 mismatch가 난다.
    // 마운트 후 1회 반영(의도된 set-state-in-effect — 드래그 중 localStorage 쓰기를 피해 부드럽게 유지).
    const v = Number(localStorage.getItem(storageKey))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(v) && v >= min && v <= max) setWidth(v)
  }, [storageKey, min, max])

  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max])
  const persist = useCallback(
    (w: number) => localStorage.setItem(storageKey, String(Math.round(w))),
    [storageKey],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { startX: e.clientX, startW: width, active: true }
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    [width],
  )
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current.active) return
      const dx = e.clientX - drag.current.startX
      setWidth(clamp(drag.current.startW + (side === 'left' ? dx : -dx)))
    },
    [clamp, side],
  )
  const onPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current.active) return
      drag.current.active = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      setWidth((w) => {
        persist(w)
        return w
      })
    },
    [persist],
  )
  // 키보드 접근성: 핸들에 포커스 후 좌/우 화살표로 16px씩 조절.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const dir = e.key === 'ArrowRight' ? 1 : -1
      setWidth((w) => {
        const n = clamp(w + 16 * dir * (side === 'left' ? 1 : -1))
        persist(n)
        return n
      })
      e.preventDefault()
    },
    [clamp, persist, side],
  )

  const separatorProps = {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-label': '패널 크기 조절',
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onKeyDown,
  }
  return { width, separatorProps }
}

export type SeparatorProps = ReturnType<typeof usePanelResize>['separatorProps']

// 얇은 세로 드래그 바. 위치·크기는 className으로 지정(flex 형제 또는 absolute right-0).
// 평소엔 투명(인접 border가 경계 역할), hover/drag 시 라인이 강조돼 조절 가능함을 알린다.
export function ResizeBar({
  separatorProps,
  className = '',
}: {
  separatorProps: SeparatorProps
  className?: string
}) {
  return (
    <div
      {...separatorProps}
      className={`group/resize z-10 cursor-col-resize touch-none select-none ${className}`}
    >
      <div className="pointer-events-none mx-auto h-full w-px bg-transparent transition-colors group-hover/resize:bg-sky-400 group-active/resize:bg-sky-500" />
    </div>
  )
}
