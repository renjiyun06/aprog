import { type Component } from 'solid-js';
import { auth, type Profile } from '../stores/auth';

/** Round user avatar. Uses uploaded image dataURL, else a colored initial. */
export const Avatar: Component<{ size: number; profile?: Profile | null }> = (p) => {
  const prof = () => p.profile ?? auth.user();
  const initial = () => (prof()?.displayName ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      class="avatar"
      style={{
        width: `${p.size}px`,
        height: `${p.size}px`,
        'font-size': `${Math.round(p.size * 0.42)}px`,
      }}
    >
      {prof()?.avatar
        ? <img src={prof()!.avatar!} alt="" />
        : <span>{initial()}</span>}
    </div>
  );
};
