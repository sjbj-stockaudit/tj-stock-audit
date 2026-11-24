import type { StampedPhoto } from '../lib/camera';
import LiveCamera from './LiveCamera';
import { useT } from '../lib/i18n';

/** Live front-camera selfie (no gallery). */
export default function SelfieCamera(props: {
  title: string;
  place: string;
  onConfirm: (photo: StampedPhoto) => void;
  confirmLabel: string;
  busy?: boolean;
}) {
  const t = useT();
  return <LiveCamera facing="user" captureLabel={t('Take selfie')} {...props} />;
}
