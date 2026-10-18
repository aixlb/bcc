import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'

interface Props {
  direction: 'horizontal' | 'vertical'
  first: React.ReactNode
  second: React.ReactNode
  defaultSize: number
  minSize?: number
  maxSize?: number
  className?: string
}

export function ResizableSplit({
  direction,
  first,
  second,
  defaultSize,
  minSize = 80,
  maxSize,
  className,
}: Props) {
  const [size, setSize] = useState(defaultSize)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(0)
  const sizeRef = useRef(size)
  sizeRef.current = size

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = sizeRef.current
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      e.preventDefault()
    },
    [direction]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const current = direction === 'horizontal' ? e.clientX : e.clientY
      const total = direction === 'horizontal' ? rect.width : rect.height
      const delta = current - startPos.current
      let newSize = startSize.current + delta
      newSize = Math.max(minSize, Math.min(maxSize ?? total - minSize, newSize))
      setSize(newSize)
    }
    const handleMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [direction, minSize, maxSize])

  const isHorizontal = direction === 'horizontal'
  const firstStyle = isHorizontal
    ? { width: size, minWidth: size, maxWidth: size, height: '100%' }
    : { height: size, minHeight: size, maxHeight: size }

  return (
    <div
      ref={containerRef}
      className={cn('flex', isHorizontal ? 'flex-row' : 'flex-col', className)}
    >
      <div style={firstStyle} className="shrink-0 overflow-hidden flex flex-col">
        {first}
      </div>
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'shrink-0 z-10 flex items-center justify-center transition-colors',
          'bg-white/[0.06] hover:bg-accent/50 active:bg-accent/60',
          isHorizontal
            ? 'w-1.5 cursor-col-resize'
            : 'h-1.5 cursor-row-resize'
        )}
      >
        <div
          className={cn(
            'rounded-full bg-white/20',
            isHorizontal ? 'h-8 w-[2px]' : 'h-[2px] w-8'
          )}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden flex flex-col">
        {second}
      </div>
    </div>
  )
}
