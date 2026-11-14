import { X } from 'lucide-react';

/** A profile picture filling the screen on black; a tap anywhere (or Close) closes it. */
export default function FullScreenPhoto({ photo, name, onClose }: { photo: string; name: string; onClose: () => void }) {
  return (
    <div className="photo-fullscreen" role="dialog" aria-label={name} onClick={onClose}>
      <img src={photo} alt={name} />
      <button className="photo-fullscreen-close" onClick={onClose} aria-label="Close">
        <X size={22} />
      </button>
    </div>
  );
}
