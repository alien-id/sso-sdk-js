import React from 'react';
import { AlienIcon } from "../assets/AlienIcon";
import styles from './SolanaSignInButton.module.css';
import { useSolanaAuth } from "../../providers";
import clsx from "clsx";

export interface SolanaSignInButtonProps {
  variant?: 'default' | 'short';
  color?: 'dark' | 'light';
}

export const SolanaSignInButton: React.FC<SolanaSignInButtonProps> = ({
  variant = 'default',
  color = 'light',
}) => {
  const { openModal } = useSolanaAuth();

  const handleClick = () => {
    openModal();
  };

  if (variant === 'short') {
    return (
      <button onClick={handleClick} className={clsx(styles.button, styles.buttonShort, color === 'light' ? styles.buttonLight : styles.buttonDark)}>
        <div className={styles.buttonIcon}><AlienIcon /></div>
      </button>
    )
  }

  return (
    <button onClick={handleClick} className={clsx(styles.button, color === 'light' ? styles.buttonLight : styles.buttonDark)}>
      <div className={styles.buttonIcon}><AlienIcon /></div>
      <span className={styles.buttonText}>Sign in with Alien ID</span>
    </button>
  );
}
