import React from 'react';
import { useStore } from '../context/StoreContext';

export const ToastContainer: React.FC = () => {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 text-sm border shadow-md transition-all ${
            toast.type === 'error'
              ? 'bg-[#A65F46] text-[#FAF9F6] border-[#8A4D38]'
              : 'bg-[#25231F] text-[#FAF9F6] border-[#3A3630]'
          }`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
};
