import type { ButtonHTMLAttributes, RefAttributes } from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'success' | 'danger' | 'ghost'
  size?: 'normal' | 'small'
  busy?: boolean
}

export function Button({ variant = 'default', size = 'normal', type = 'button', className = '', busy = false, onClick, ...props }: ButtonProps) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} {...props} aria-busy={busy || undefined} aria-disabled={busy || props['aria-disabled']} onClick={(event) => {
    if (busy || props['aria-disabled'] === true || props['aria-disabled'] === 'true') { event.preventDefault(); return }
    onClick?.(event)
  }} />
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & RefAttributes<HTMLButtonElement> & {
  label: string
}

export function IconButton({ label, type = 'button', className = '', ...props }: IconButtonProps) {
  return <button type={type} aria-label={label} className={`ui-icon-button ${className}`} {...props} />
}
