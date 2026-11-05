// WCAG relative luminance for the actual opaque sRGB pairs recorded by the browser.
export function contrastRatio(first: string, second: string) {
  const luminance = (color: string) => {
    const match = color.match(/^rgb\((\d+)[ ,]+(\d+)[ ,]+(\d+)\)$/)
    if (!match) throw new Error(`Expected an opaque computed RGB color, received ${color}`)
    const rgb = match.slice(1).map((value) => {
      const channel = Number(value) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
