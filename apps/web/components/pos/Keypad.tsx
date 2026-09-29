import React from 'react';

interface KeypadProps {
  onInput: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}

export default function Keypad({ onInput, onClear, onSubmit }: KeypadProps) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'Pay'];

  const handlePress = (key: string) => {
    if (typeof window !== 'undefined' && window.navigator.vibrate) {
      window.navigator.vibrate(50);
    }

    if (key === 'C') {
      onClear();
    } else if (key === 'Pay') {
      onSubmit();
    } else {
      onInput(key);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-2 w-full max-w-sm mx-auto">
      {keys.map((key) => (
        <button
          key={key}
          onClick={() => handlePress(key)}
          className={`h-16 text-2xl font-bold rounded-lg shadow active:scale-95 transition-transform ${
            key === 'Pay'
              ? 'bg-blue-600 text-white'
              : key === 'C'
                ? 'bg-red-100 text-red-600'
                : 'bg-gray-100 text-gray-900'
          }`}
          style={{ minWidth: '48px', minHeight: '48px' }}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
