import React from 'react';
import { AlienIcon } from "../assets/AlienIcon";
import styles from './SignInButton.module.css';
import { useAuth } from "../../providers";
import clsx from "clsx";

export interface SignInButtonProps {
  variant?: 'default' | 'short';
}

export const SignInButton: React.FC<SignInButtonProps> = ({
  variant = 'default',
}) => {
  const { openModal } = useAuth();

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
      Sign in with Alien ID
      <div className={styles.buttonSpace} />
    </button>
  );
}
