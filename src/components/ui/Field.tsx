import { cloneElement, useId } from 'react'
import type { AriaAttributes, InputHTMLAttributes, ReactElement, RefAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type FieldProps = {
  label: string
  description?: string
  error?: string
  id?: string
}

type ControlProps = AriaAttributes & { id?: string; className?: string }

export function Field({ label, description, error, id, children }: FieldProps & { children: ReactElement<ControlProps> }) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const describedBy = [children.props['aria-describedby'], description ? `${controlId}-help` : '', error ? `${controlId}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="ui-field">
      <label htmlFor={controlId}>{label}</label>
      {cloneElement(children, {
        id: controlId,
        className: `ui-control ${children.props.className ?? ''}`,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })}
      {description && <p className="ui-help" id={`${controlId}-help`}>{description}</p>}
      {error && <p className="ui-error" id={`${controlId}-error`}>{error}</p>}
    </div>
  )
}

export function InputField({ label, description, error, id, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement> & RefAttributes<HTMLInputElement>) {
  return <Field label={label} description={description} error={error} id={id}><input {...props} /></Field>
}

export function SelectField({ label, description, error, id, children, ...props }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return <Field label={label} description={description} error={error} id={id}><select {...props}>{children}</select></Field>
}

export function TextareaField({ label, description, error, id, ...props }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement> & RefAttributes<HTMLTextAreaElement>) {
  return <Field label={label} description={description} error={error} id={id}><textarea {...props} /></Field>
}

export function CheckboxField({ label, description, error, id, ...props }: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  return (
    <div className="ui-field">
      <label className="ui-checkbox" htmlFor={controlId}>
        <input {...props} id={controlId} type="checkbox" aria-invalid={error ? true : props['aria-invalid']} aria-describedby={[props['aria-describedby'], description ? `${controlId}-help` : '', error ? `${controlId}-error` : ''].filter(Boolean).join(' ') || undefined} />
        <span>{label}</span>
      </label>
      {description && <p className="ui-help" id={`${controlId}-help`}>{description}</p>}
      {error && <p className="ui-error" id={`${controlId}-error`}>{error}</p>}
    </div>
  )
}
