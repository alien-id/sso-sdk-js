import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../providers';
import { ModalBase } from '../base/ModalBase';
import { SignInPanel } from './SignInPanel';

export const SignInModal = () => {
  const {
    isModalOpen: isOpen,
    closeModal: onClose,
    queryClient,
    claimModalSlot,
    releaseModalSlot,
  } = useAuth();

  // The provider auto-renders one modal; a manually-rendered one would stack
  // its overlay. Only the slot holder renders; re-claim on each open so a
  // survivor takes over if the holder unmounted.
  const slotInstanceRef = useRef<object>({});
  const [hasSlot, setHasSlot] = useState(false);
  useEffect(() => {
    setHasSlot(claimModalSlot(slotInstanceRef.current));
  }, [claimModalSlot, isOpen]);
  useEffect(() => {
    const instance = slotInstanceRef.current;
    return () => releaseModalSlot(instance);
  }, [releaseModalSlot]);

  // Drop the cache entries on close so the next open starts from a clean fetch.
  const handleClose = () => {
    onClose();
    queryClient.removeQueries({ queryKey: ['auth-deeplink'] });
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
    queryClient.removeQueries({ queryKey: ['auth-exchange'] });
  };

  if (!hasSlot) {
    return null;
  }

  return (
    <SignInPanel
      active={isOpen}
      onClose={handleClose}
      wrap={(content, { isSuccess }) => (
        <ModalBase onClose={handleClose} isOpen={isOpen} showClose={!isSuccess}>
          {content}
        </ModalBase>
      )}
    />
  );
};
