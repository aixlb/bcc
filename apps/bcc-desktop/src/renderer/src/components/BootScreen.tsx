import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useAnimationFrame, animate } from 'framer-motion'
import { LogoIcon } from './LogoIcon'
import film1 from '../assets/films/film1.png'
import film2 from '../assets/films/film2.png'
import film3 from '../assets/films/film3.png'
import film4 from '../assets/films/film4.png'
import film5 from '../assets/films/film5.png'

interface BootScreenProps {
  onComplete: () => void
}

// Pre-decode film images at module load — GPU-ready before animation starts
const _filmDecoded = Promise.all(
  [film1, film2, film3, film4, film5].map(src =>
    Object.assign(new Image(), { src }).decode().catch(() => {})
  )
)

const R = 158

// Random orbit speed per session: 0.5–0.9 rad/s
const ORBIT_SPEED = Math.random() * 0.4 + 0.5

const JUMPERS = [
  { id: 0, img: film1, x: 0,                                   y: -R,                                 glideDelay: 0.00 },
  { id: 1, img: film2, x: R * Math.sin(Math.PI * 2 / 5 * 1),  y: -R * Math.cos(Math.PI * 2 / 5 * 1), glideDelay: 0.10 },
  { id: 2, img: film3, x: R * Math.sin(Math.PI * 2 / 5 * 2),  y: -R * Math.cos(Math.PI * 2 / 5 * 2), glideDelay: 0.20 },
  { id: 3, img: film4, x: R * Math.sin(Math.PI * 2 / 5 * 3),  y: -R * Math.cos(Math.PI * 2 / 5 * 3), glideDelay: 0.30 },
  { id: 4, img: film5, x: R * Math.sin(Math.PI * 2 / 5 * 4),  y: -R * Math.cos(Math.PI * 2 / 5 * 4), glideDelay: 0.40 },
]

// Ambient particles — CSS @keyframes only, zero JS animation cost
const AMBIENT = Array.from({ length: 36 }, (_, i) => ({
  id:      i,
  x:       ((i * 173 + 97)  % 997) / 997 * 920 - 460,
  y:       ((i * 613 + 331) % 997) / 997 * 600 - 300,
  size:    ((i * 1009 + 17) % 100) / 100 * 2.2 + 0.4,
  opacity: ((i * 443 + 521) % 100) / 100 * 0.28 + 0.05,
  delay:   ((i * 271 + 89)  % 100) / 100 * 6.0,
  dur:     ((i * 359 + 211) % 100) / 100 * 5.0 + 3.5,
  color:   ['#fbbf24', '#e2e8f0', '#a78bfa', '#f472b6', '#2dd4bf'][i % 5],
  driftX:  (((i * 127 + 43) % 100) / 100 - 0.5) * 55,
  driftY:  -(((i * 239 + 137) % 100) / 100 * 75 + 20),
}))

const AMBIENT_CSS = AMBIENT.map(p => {
  const x2 = p.x + p.driftX, y2 = p.y + p.driftY
  const x3 = p.x + p.driftX * 0.4, y3 = p.y + p.driftY * 1.3
  return `
    @keyframes amb${p.id} {
      0%   { transform:translate(${p.x}px,${p.y}px); opacity:0; }
      28%  { transform:translate(${x2}px,${y2}px); opacity:${p.opacity.toFixed(3)}; }
      62%  { transform:translate(${x3}px,${y3}px); opacity:${(p.opacity * 1.4).toFixed(3)}; }
      88%  { transform:translate(${p.x}px,${p.y}px); opacity:${(p.opacity * 0.3).toFixed(3)}; }
      100% { transform:translate(${p.x}px,${p.y}px); opacity:0; }
    }
  `
}).join('')

const CAT_BURST = Array.from({ length: 24 }, (_, i) => ({
  id:    i,
  angle: (i / 24) * Math.PI * 2,
  dist:  60 + ((i * 53 + 11) % 100),
  size:  1.5 + ((i * 11 + 3) % 25) / 10,
  delay: ((i * 29 + 7) % 100) / 100 * 0.16,
  dur:   0.40 + ((i * 37 + 13) % 100) / 100 * 0.34,
  color: ['#fbbf24', '#fde68a', '#ffffff', '#f59e0b'][i % 4],
}))

const CONV_RINGS = [
  { size: 180, dur: 0.60, delay: 0 },
  { size: 130, dur: 0.46, delay: 0.07 },
]

const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1]
const EXPO_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

// Mathematical expo-out for radius interpolation
function expoOut(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

type Phase = 'waiting' | 'gliding' | 'orbiting' | 'converging'

function GlideIcon({
  img, x, y, glideDelay, visible, converging, convDelay,
}: {
  img: string; x: number; y: number
  glideDelay: number; visible: boolean; converging: boolean; convDelay: number
}) {
  // MotionValues → DOM direct, no React re-renders during animation
  const mx       = useMotionValue(x * 3)
  const my       = useMotionValue(y * 3)
  const mScale   = useMotionValue(0.72)
  const mOpacity = useMotionValue(0)

  const phaseRef      = useRef<Phase>('waiting')
  const angleRef      = useRef(Math.atan2(y, x)) // matches (x,y) at radius R
  const radiusRef     = useRef(R * 3)
  const glideStartRef = useRef(-1)               // rAF timestamp, set on first gliding frame
  const convergingRef = useRef(converging)
  useEffect(() => { convergingRef.current = converging }, [converging])

  // Single rAF loop: handles spiral glide-in AND orbit — direct motionValue writes, zero overhead
  useAnimationFrame((time, delta) => {
    const phase = phaseRef.current
    if (phase === 'waiting' || phase === 'converging') return

    // Pin glide start to the exact rAF timestamp (eliminates setTimeout drift)
    if (glideStartRef.current < 0) glideStartRef.current = time

    // Angle increases continuously throughout glide AND orbit
    angleRef.current += ORBIT_SPEED * (delta / 1000)

    if (phase === 'gliding') {
      const t = Math.min((time - glideStartRef.current) / 750, 1) // 750 ms glide
      radiusRef.current = R * 3 + (R - R * 3) * expoOut(t)        // 3R → R, expo-out
      if (t >= 1) { phaseRef.current = 'orbiting'; radiusRef.current = R }
    }

    mx.set(Math.cos(angleRef.current) * radiusRef.current)
    my.set(Math.sin(angleRef.current) * radiusRef.current)
  })

  useEffect(() => {
    if (!visible) return

    if (converging) {
      phaseRef.current = 'converging'
      // animate() reads current motionValue (mid-orbit) and smoothly pulls to center
      animate(mx,       0, { duration: 0.44, ease: EASE_IN,  delay: convDelay } as any)
      animate(my,       0, { duration: 0.44, ease: EASE_IN,  delay: convDelay } as any)
      animate(mScale,   0, { duration: 0.44, ease: EASE_IN,  delay: convDelay } as any)
      animate(mOpacity, 0, { duration: 0.20, ease: 'easeIn', delay: convDelay + 0.20 } as any)
      return
    }

    const t = setTimeout(() => {
      glideStartRef.current = -1  // reset so rAF records the precise start frame
      phaseRef.current = 'gliding'
    }, glideDelay * 1000)

    animate(mOpacity, 1, { duration: 0.18, delay: glideDelay } as any)
    animate(mScale,   1, { duration: 0.75, delay: glideDelay, ease: EXPO_OUT } as any)

    return () => clearTimeout(t)
  }, [visible, converging]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ x: mx, y: my, scale: mScale, opacity: mOpacity, willChange: 'transform, opacity' }}
    >
      <div
        style={{
          width: 72, height: 72,
          borderRadius: 11,
          overflow: 'hidden',
          transform: 'translate(-50%,-50%) translateZ(0)',
          boxShadow: '0 0 22px rgba(255,255,255,0.13), 0 0 6px rgba(255,255,255,0.22), 0 6px 20px rgba(0,0,0,0.55)',
        }}
      >
        <img
          src={img}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', mixBlendMode: 'screen' } as React.CSSProperties}
        />
      </div>
    </motion.div>
  )
}

export function BootScreen({ onComplete }: BootScreenProps) {
  const [catVisible,     setCatVisible]     = useState(false)
  const [catBurstKey,    setCatBurstKey]    = useState(0)
  const [glidersVisible, setGlidersVisible] = useState(false)
  const [converging,     setConverging]     = useState(false)
  const [convRingKey,    setConvRingKey]    = useState(0)
  const [showTitle,      setShowTitle]      = useState(false)
  const [exiting,        setExiting]        = useState(false)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)) }
    let cancelled = false

    at(200, () => { setCatVisible(true); setCatBurstKey(k => k + 1) })

    _filmDecoded.then(() => {
      if (cancelled) return
      at(380,  () => setGlidersVisible(true))
      at(2400, () => { setConverging(true); setConvRingKey(k => k + 1) })
      at(2850, () => setShowTitle(true))
      at(4180, () => setExiting(true))
      at(4650, () => onComplete())
    })

    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [])

  const titleChars = 'XLB STORYBOARD'

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
          style={{ background: '#040408' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.38, ease: [0.4, 0, 0.2, 1] }}
        >
          <style>{AMBIENT_CSS}</style>

          {/* Scanlines */}
          <div className="pointer-events-none absolute inset-0" style={{
            background: 'repeating-linear-gradient(180deg, transparent 0, transparent 2px, rgba(255,255,255,0.007) 2px, rgba(255,255,255,0.007) 3px)',
          }} />
          {/* Vignette */}
          <div className="pointer-events-none absolute inset-0" style={{
            background: 'radial-gradient(ellipse 78% 68% at 50% 50%, transparent 18%, rgba(0,0,0,0.82) 100%)',
          }} />

          {/* Ambient dust — pure CSS, GPU composited */}
          {AMBIENT.map(p => (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                width: p.size, height: p.size,
                borderRadius: '50%',
                backgroundColor: p.color,
                animation: `amb${p.id} ${p.dur}s ${p.delay}s infinite ease-in-out`,
                willChange: 'transform, opacity',
              }}
            />
          ))}

          {/* Film icons — spiral in while rotating, then orbit */}
          {JUMPERS.map((j, i) => (
            <GlideIcon
              key={j.id}
              img={j.img}
              x={j.x} y={j.y}
              glideDelay={j.glideDelay}
              visible={glidersVisible}
              converging={converging}
              convDelay={i * 0.05}
            />
          ))}

          {/* Convergence shockwave rings */}
          {convRingKey > 0 && CONV_RINGS.map((r, i) => (
            <motion.div
              key={`cring-${convRingKey}-${i}`}
              className="absolute pointer-events-none"
              style={{
                width: r.size, height: r.size, borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.22)',
                marginLeft: -r.size / 2, marginTop: -r.size / 2,
                willChange: 'transform, opacity',
              }}
              initial={{ scale: 0.05, opacity: 0.85 }}
              animate={{ scale: 3.2, opacity: 0 }}
              transition={{ duration: r.dur, delay: r.delay, ease: [0.2, 0, 0.6, 0.2] }}
            />
          ))}

          {/* Cat reveal burst */}
          {catBurstKey > 0 && CAT_BURST.map(p => (
            <motion.div
              key={`cb-${catBurstKey}-${p.id}`}
              className="absolute pointer-events-none"
              style={{
                width: p.size, height: p.size, borderRadius: '50%', backgroundColor: p.color,
                boxShadow: `0 0 ${p.size + 1}px ${p.color}90`,
                willChange: 'transform, opacity',
              }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1.5 }}
              animate={{ x: Math.cos(p.angle) * p.dist, y: Math.sin(p.angle) * p.dist, opacity: 0, scale: 0.1 }}
              transition={{ duration: p.dur, delay: p.delay, ease: [0.22, 0.61, 0.36, 1] }}
            />
          ))}

          {/* Cat logo */}
          {catVisible && (
            <motion.div
              className="absolute"
              style={{ willChange: 'transform, opacity' }}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                opacity: { duration: 0.22 },
                scale:   { type: 'spring', stiffness: 360, damping: 26 },
              }}
            >
              <LogoIcon className="h-[96px] w-[96px]" />
            </motion.div>
          )}

          {/* Brand text */}
          {showTitle && (
            <div
              className="pointer-events-none absolute"
              style={{ top: 'calc(50% + 88px)', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
            >
              <h1
                className="text-center font-light text-zinc-200"
                style={{ fontSize: '14px', letterSpacing: '0.44em' }}
              >
                {titleChars.split('').map((char, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.30, delay: i * 0.034, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{ display: 'inline-block' }}
                  >
                    {char === ' ' ? ' ' : char}
                  </motion.span>
                ))}
              </h1>
              <motion.p
                className="mt-2 text-center font-light text-zinc-400"
                style={{ fontSize: '11px', letterSpacing: '0.18em' }}
              >
                {'@玩AI的小笼包'.split('').map((char, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.30, delay: i * 0.034, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{ display: 'inline-block' }}
                  >
                    {char}
                  </motion.span>
                ))}
              </motion.p>
            </div>
          )}

          <div className="absolute bottom-5 right-5 font-mono text-[10px]" style={{ color: '#12121a' }}>
            v{__APP_VERSION__}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
