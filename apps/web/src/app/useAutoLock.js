import { useEffect } from 'react';
import { useAppSetting } from '../lib/appSettings';
import { toast } from '../components/ui/Toast';

// Settings > General > Auto-lock: after this many idle minutes the person is signed out, so a screen left open on a shared
// counter does not stay open to the books. Any key, click, scroll or touch counts as activity. "never" turns it off.
export default function useAutoLock(signedIn, signOut) {
  const setting = useAppSetting('sec.autoLock');
  useEffect(() => {
    const minutes = Number(setting);
    if (!signedIn || !minutes) return undefined;
    let timer;
    const fire = () => {
      toast(`Signed out after ${minutes} minute${minutes === 1 ? '' : 's'} without activity`, 'info');
      signOut();
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(fire, minutes * 60_000);
    };
    const events = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [setting, signedIn, signOut]);
}
