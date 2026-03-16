const sharp = require('sharp')
const pngToIco = require('png-to-ico')
const fs = require('fs')
const path = require('path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1a3e"/>
      <stop offset="100%" stop-color="#0d0d2b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7788ff"/>
      <stop offset="100%" stop-color="#4444cc"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- 背景圆角矩形 -->
  <rect width="256" height="256" rx="48" fill="url(#bg)"/>

  <!-- 外圈装饰环 -->
  <circle cx="128" cy="128" r="100" fill="none" stroke="#3333aa" stroke-width="2" stroke-dasharray="8 6" opacity="0.5"/>

  <!-- 压缩符号：四角箭头向中心 -->
  <!-- 左上角箭头 -->
  <g fill="url(#accent)" filter="url(#glow)">
    <polygon points="52,52 90,52 52,90" opacity="0.9"/>
    <polygon points="52,52 62,52 52,62"/>
  </g>
  <!-- 右上角箭头 -->
  <g fill="url(#accent)" filter="url(#glow)">
    <polygon points="204,52 166,52 204,90" opacity="0.9"/>
    <polygon points="204,52 194,52 204,62"/>
  </g>
  <!-- 左下角箭头 -->
  <g fill="url(#accent)" filter="url(#glow)">
    <polygon points="52,204 90,204 52,166" opacity="0.9"/>
    <polygon points="52,204 62,204 52,194"/>
  </g>
  <!-- 右下角箭头 -->
  <g fill="url(#accent)" filter="url(#glow)">
    <polygon points="204,204 166,204 204,166" opacity="0.9"/>
    <polygon points="204,204 194,204 204,194"/>
  </g>

  <!-- 中心文件图标 -->
  <rect x="96" y="82" width="72" height="90" rx="8" fill="#252560" stroke="#5566dd" stroke-width="2"/>
  <!-- 折角 -->
  <polygon points="140,82 168,110 140,110" fill="#1a1a45" stroke="#5566dd" stroke-width="1.5"/>
  <!-- 文件内的线条 -->
  <line x1="108" y1="124" x2="148" y2="124" stroke="#5566dd" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
  <line x1="108" y1="136" x2="148" y2="136" stroke="#5566dd" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
  <line x1="108" y1="148" x2="132" y2="148" stroke="#5566dd" stroke-width="2.5" stroke-linecap="round" opacity="0.4"/>

  <!-- 底部压缩标志 -->
  <rect x="100" y="186" width="56" height="18" rx="9" fill="#4444bb"/>
  <text x="128" y="199" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="11" fill="white" letter-spacing="1">压缩</text>
</svg>`

async function buildIcon() {
  if (!fs.existsSync('assets')) fs.mkdirSync('assets')

  // 生成 256x256 PNG 保存到文件
  const pngPath = path.join('assets', 'icon.png')
  await sharp(Buffer.from(svg))
    .resize(256, 256)
    .png()
    .toFile(pngPath)
  console.log('✓ 生成 256x256 PNG')

  // 用文件路径转 ICO（库内部自动多尺寸）
  const icoBuffer = await pngToIco.default(pngPath)
  fs.writeFileSync('assets/icon.ico', icoBuffer)
  console.log('✓ 图标已生成：assets/icon.ico')
}

buildIcon().catch(console.error)
