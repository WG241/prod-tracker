import type { ButtonHTMLAttributes } from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'success' | 'danger' | 'ghost'
  size?: 'normal' | 'small'
}

export function Button({ variant = 'default', size = 'normal', type = 'button', className = '', ...props }: ButtonProps) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} {...props} />
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string
}

export function IconButton({ label, type = 'button', className = '', ...props }: IconButtonProps) {
  return <button type={type} aria-label={label} className={`ui-icon-button ${className}`} {...props} />
}
