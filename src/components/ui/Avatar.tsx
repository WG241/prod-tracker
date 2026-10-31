export function Avatar({ name, tone = 'blue' }: { name: string; tone?: 'blue' | 'teal' | 'lilac' | 'sand' }) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const initials = words.length ? `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : ''}`.toLocaleUpperCase('en-GB') : '?'
  return <span className={`ui-avatar ui-avatar-${tone}`} aria-hidden="true">{initials}</span>
}
