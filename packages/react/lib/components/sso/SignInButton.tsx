import React from 'react';
import { AlienIcon } from '../assets/AlienIcon';
import styles from './SignInButton.module.css';
import { AGENT_HINT, useAuth } from '../../providers';
import clsx from 'clsx';

export interface SignInButtonProps {
  variant?: 'default' | 'short';
  color?: 'dark' | 'light';
}

export const SignInButton: React.FC<SignInButtonProps> = ({
  variant = 'default',
  color = 'light',
}) => {
  const { openModal, agentIdEnabled } = useAuth();

  if (variant === 'short') {
    return (
      <button
        onClick={openModal}
        className={clsx(
          styles.button,
          styles.buttonShort,
          color === 'light' ? styles.buttonLight : styles.buttonDark,
        )}
        data-agent-id={agentIdEnabled ? AGENT_HINT : undefined}
      >
        <div className={styles.buttonIcon}>
          <AlienIcon />
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={openModal}
      className={clsx(
        styles.button,
        color === 'light' ? styles.buttonLight : styles.buttonDark,
        agentIdEnabled && styles.buttonWithAgent,
      )}
      data-agent-id={agentIdEnabled ? AGENT_HINT : undefined}
    >
      <div className={styles.buttonIcon}>
        <AlienIcon />
      </div>
      <span className={styles.buttonText}>
        Sign in with Alien ID
        {agentIdEnabled && (
          <span className={styles.agentIdText}>or with Alien Agent ID</span>
        )}
      </span>
    </button>
  );
};
