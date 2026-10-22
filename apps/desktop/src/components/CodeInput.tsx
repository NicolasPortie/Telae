import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { t } from '../i18n'

const LENGTH = 6

/** Código numérico em casas separadas: avança sozinho, volta com Backspace e aceita colar o código inteiro. */
export function CodeInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const boxes = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: LENGTH }, (_, index) => value[index] ?? '')

  // O cursor já cai na primeira casa: quem chega aqui só quer digitar o código.
  useEffect(() => { boxes.current[0]?.focus() }, [])

  const focusBox = (index: number) => boxes.current[Math.max(0, Math.min(LENGTH - 1, index))]?.focus()

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice()
    next[index] = digit
    onChange(next.join('').slice(0, LENGTH))
  }

  const handleChange = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '')
    if (!typed) {
      setDigit(index, '')
      return
    }
    if (typed.length > 1) {
      // Autofill ou colagem em uma casa só: espalha a partir dela.
      const filled = (value.slice(0, index) + typed).slice(0, LENGTH)
      onChange(filled)
      focusBox(Math.min(filled.length, LENGTH - 1))
      return
    }
    setDigit(index, typed)
    focusBox(index + 1)
  }

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]) {
      event.preventDefault()
      if (index > 0) {
        setDigit(index - 1, '')
        focusBox(index - 1)
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusBox(index - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusBox(index + 1)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH)
    if (!pasted) return
    event.preventDefault()
    onChange(pasted)
    focusBox(Math.min(pasted.length, LENGTH - 1))
  }

  return (
    <div role="group" aria-label={t('Código de 6 dígitos')} className="flex gap-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={element => { boxes.current[index] = element }}
          value={digit}
          onChange={event => handleChange(index, event.target.value)}
          onKeyDown={event => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={event => event.target.select()}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={t('Dígito {number}', { number: index + 1 })}
          disabled={disabled}
          className="otp-box"
        />
      ))}
    </div>
  )
}
