import React from 'react';
import { AlienIcon } from "../assets/AlienIcon";
import styles from './SolanaSignInButton.module.css';
import { useSolanaAuth } from "../../providers";
import clsx from "clsx";

export interface SolanaSignInButtonProps {
  variant?: 'default' | 'short';
  solanaAddress: string;
}

export const SolanaSignInButton: React.FC<SolanaSignInButtonProps> = ({
  variant = 'default',
  solanaAddress,
}) => {
  const { openModal } = useSolanaAuth();

  const handleClick = () => {
    openModal(solanaAddress);
  };

  if (variant === 'short') {
    return (
      <button onClick={handleClick} className={clsx(styles.button, styles.buttonShort)}>
        <div className={styles.buttonIcon}><AlienIcon /></div>
      </button>
    )
  }

  return (
    <button onClick={handleClick} className={styles.button}>
      <div className={styles.buttonIcon}><AlienIcon /></div>
      <span className={styles.buttonText}>Sign in with Alien ID</span>
    </button>
  );
}
