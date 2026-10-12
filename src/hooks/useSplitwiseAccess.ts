import { useEffect, useState } from 'react';
import { get, ref } from 'firebase/database';
import { db } from '../firebase';

/**
 * Whether the signed-in account is on the Splitwise allow-list (splitwiseUsers/{uid} = true, edited in the
 * Firebase console). Only those accounts see Splitwise anywhere — the same rule as the iOS app.
 */
export function useSplitwiseAccess(uid: string | undefined): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(false);
    if (!uid) return;
    let live = true;
    get(ref(db, `splitwiseUsers/${uid}`))
      .then((snapshot) => {
        if (live) setAllowed(snapshot.val() === true);
      })
      .catch(() => {
        if (live) setAllowed(false);
      });
    return () => {
      live = false;
    };
  }, [uid]);

  return allowed;
}
