import React from 'react';
import { AlienIcon } from "../assets/AlienIcon";
import styles from './SolanaSignInButton.module.css';
import { useSolanaAuth } from "../../providers";
import clsx from "clsx";

export interface SolanaSignInButtonProps {
  variant?: 'default' | 'short';
}

export const SolanaSignInButton: React.FC<SolanaSignInButtonProps> = ({
  variant = 'default',
}) => {
  const { openModal } = useSolanaAuth();

  if (variant === 'short') {
    return (
      <button onClick={openModal} className={clsx(styles.button, styles.buttonShort)}>
        <div className={styles.buttonIcon}><AlienIcon /></div>
      </button>
    )
  }

  return (
    <button onClick={openModal} className={styles.button}>
      <div className={styles.buttonIcon}><AlienIcon /></div>
      <span className={styles.buttonText}>Sign in with Alien ID</span>
    </button>
  );
}
