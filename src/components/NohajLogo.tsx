import React from 'react';

interface NohajLogoProps {
  variant?: 'full' | 'wordmark';
  className?: string;
  light?: boolean;
}

export const NohajLogo: React.FC<NohajLogoProps> = ({
  className = '',
  light = false,
}) => {
  return (
    <img
      src="/assets/aistudio/Nohaj_Logo_Croped_767d0307.jpeg"
      alt="NOHAJ"
      className={`h-9 sm:h-10 w-auto object-contain select-none ${
        light ? 'invert mix-blend-screen' : 'mix-blend-multiply'
      } ${className}`}
    />
  );
};
