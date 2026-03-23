/**
 * VLogo.jsx — Logo SVG pur de Veridex
 *
 * Bouclier asymétrique glassmorphism émeraude + V typographique DM Sans 800.
 * Fonctionne à toutes les tailles, de 16px (favicon) à 512px (PWA icon).
 *
 * Props :
 *   size      : number  — taille en px (défaut : 32)
 *   className : string  — classes CSS optionnelles
 *   variant   : 'dark' | 'light'  — contexte de fond (défaut : 'dark')
 */

import { useId } from 'react'

export default function VLogo({ size = 32, className = '', variant = 'dark' }) {
  const id = useId()

  const vColor = '#00C896'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Veridex"
    >
      <defs>
        {/* Fond glassmorphism émeraude */}
        <linearGradient id={`glass-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#00C896" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#00C896" stopOpacity="0.04"/>
        </linearGradient>
        {/* Bordure gradient émeraude → transparent */}
        <linearGradient id={`border-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#00E5A8" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#00C896" stopOpacity="0.1"/>
        </linearGradient>
      </defs>

      {/* Bouclier asymétrique — épaule gauche plus haute */}
      <path
        d="M48 6 L82 20 L82 52 C82 68 66 80 48 88 C30 80 14 68 14 52 L14 20 Z"
        fill={`url(#glass-${id})`}
        stroke={`url(#border-${id})`}
        strokeWidth="1.5"
      />

      {/* Reflet glassmorphism haut */}
      <path
        d="M22 22 L48 14 L74 22 L74 26 L48 18 L22 26 Z"
        fill="white"
        opacity="0.06"
      />

      {/* V typographique DM Sans 800 */}
      <text
        x="48"
        y="56"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="'DM Sans', sans-serif"
        fontWeight="800"
        fontSize="40"
        fill={vColor}
        letterSpacing="-1.2"
      >
        V
      </text>
    </svg>
  )
}
