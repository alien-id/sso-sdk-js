import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './ModalBase.module.css';
import { CrossIcon } from "../assets/CrossIcon";

export interface ModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const ModalBase: React.FC<ModalBaseProps> = ({ isOpen, onClose, children }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={styles.modal}>
        <div className={styles.closeContainer}>
          <div className={styles.closeIcon} onClick={onClose}>
            <CrossIcon />
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};
