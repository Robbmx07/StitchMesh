import { ChangeEvent, useEffect, useState } from 'react';
import { formatNumber } from '@/utils/units';

/**
 * Shared "controlled but not while typing" behavior for numeric text
 * inputs: local text state only re-syncs from the committed value while
 * the field is NOT focused, so an intermediate value the browser can't
 * parse yet (a lone "-", a trailing ".", "1.") is never clobbered back to
 * "0" mid-keystroke — the bug that previously ate a typed minus sign.
 */
export function useNumberInput(value: number, onChange: (v: number) => void, precision = 4) {
  const [text, setText] = useState(() => formatNumber(value, precision));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatNumber(value, precision));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    setText(raw);
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return; // incomplete — wait for more input
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  const handleFocus = () => setFocused(true);
  const handleBlur = () => {
    setFocused(false);
    setText(formatNumber(value, precision));
  };

  return { text, handleChange, handleFocus, handleBlur };
}
