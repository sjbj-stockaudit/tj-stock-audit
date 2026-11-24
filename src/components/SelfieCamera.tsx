import type { StampedPhoto } from '../lib/camera';
import LiveCamera from './LiveCamera';

/** Live front-camera selfie (no gallery). */
export default function SelfieCamera(props: {
  title: string;
  place: string;
  onConfirm: (photo: StampedPhoto) => void;
  confirmLabel: string;
  busy?: boolean;
}) {
  return <LiveCamera facing="user" captureLabel="Take selfie" {...props} />;
}
